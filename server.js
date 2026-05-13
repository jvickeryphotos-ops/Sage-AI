import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = process.env.PORT || 3000;
const TARGET_URL = process.env.PROXY_TARGET_URL;
const API_KEY = process.env.PROXY_API_KEY;
const AUTH_HEADER = process.env.PROXY_AUTH_HEADER || 'Authorization';
const AUTH_PREFIX = process.env.PROXY_AUTH_PREFIX || 'Bearer';
const PROXY_PROVIDER = (process.env.PROXY_PROVIDER || '').trim().toLowerCase();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function getContentType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body ? JSON.parse(body) : {};
}

function detectProvider(providerOverride) {
  if (providerOverride) return providerOverride.toLowerCase();
  if (PROXY_PROVIDER) return PROXY_PROVIDER;
  if (!TARGET_URL) return null;
  const lower = TARGET_URL.toLowerCase();
  if (lower.includes('openai.com')) return 'openai';
  if (lower.includes('anthropic.com')) return 'anthropic';
  if (lower.includes('huggingface.co')) return 'huggingface';
  return null;
}

function flattenMessageContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(item => {
      if (!item) return '';
      if (item.type === 'text') return item.text || '';
      if (item.type === 'image') return item.caption || '[Image attachment]';
      return item.text || '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function translateToOpenAI(payload) {
  const { system, messages = [], model, max_tokens, temperature, ...rest } = payload;
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }
  if (Array.isArray(messages)) {
    messages.forEach(msg => {
      if (!msg || !msg.role) return;
      const text = flattenMessageContent(msg.content);
      if (!text) return;
      openaiMessages.push({ role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'user', content: text });
    });
  }

  const body = {
    model: model || 'gpt-4o-mini',
    messages: openaiMessages,
    max_tokens: max_tokens,
    temperature: temperature,
    ...rest,
  };

  // Remove undefined fields
  Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);
  return body;
}

function translateToHuggingFace(payload) {
  let prompt = '';
  if (payload.system) prompt += payload.system + '\n\n';
  if (Array.isArray(payload.messages)) {
    payload.messages.forEach(msg => {
      const text = flattenMessageContent(msg.content);
      if (!text) return;
      const speaker = msg.role === 'assistant' ? 'Assistant:' : 'User:';
      prompt += `${speaker} ${text}\n`;
    });
  }
  return {
    inputs: prompt.trim(),
    parameters: {
      max_new_tokens: payload.max_tokens || 1000,
    },
  };
}

function buildProxyBody(payload, providerOverride) {
  const provider = detectProvider(providerOverride);
  if (provider === 'openai') return translateToOpenAI(payload);
  if (provider === 'huggingface') return translateToHuggingFace(payload);
  return payload;
}

async function handleProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (!TARGET_URL || !API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy not configured. Set PROXY_TARGET_URL and PROXY_API_KEY.' }));
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
    return;
  }

  const providerOverride = payload.proxy_provider || payload.provider;
  delete payload.proxy_provider;
  delete payload.provider;

  try {
    const proxyBody = buildProxyBody(payload, providerOverride);
    const provider = detectProvider(providerOverride);
    console.log('Proxying request -> target:', TARGET_URL, 'provider:', provider || 'unknown');

    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [AUTH_HEADER]: `${AUTH_PREFIX} ${API_KEY}`,
      },
      body: JSON.stringify(proxyBody),
    });

    const text = await response.text();
    if (!response.ok) {
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Target API returned ${response.status}`, status: response.status, body: text }));
      return;
    }

    const headers = { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' };
    res.writeHead(response.status, headers);
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy request failed', detail: err.message }));
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === '/' ? '/Sage-ui.html' : url.pathname;
  filePath = normalize(filePath);

  if (filePath.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const fullPath = join(process.cwd(), filePath);
  try {
    const fileStat = await stat(fullPath);
    if (fileStat.isDirectory()) {
      res.writeHead(301, { Location: '/' });
      res.end();
      return;
    }
    const data = await readFile(fullPath);
    res.writeHead(200, { 'Content-Type': getContentType(fullPath) });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  setCorsHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/proxy') {
    await handleProxy(req, res);
    return;
  }

  await serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Proxy target:', TARGET_URL || 'not configured');
});
