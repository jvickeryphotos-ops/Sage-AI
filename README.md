# Sage AI Generic Proxy

This project includes a lightweight generic proxy server for forwarding chat requests to any target LLM API.

## What it does

- Serves `Sage-ui.html` at `http://localhost:3000`
- Proxies POST requests from the browser to an external API endpoint
- Keeps your API key out of client-side code
- Supports any provider that accepts JSON bodies and bearer-style headers

## Configuration

Create environment variables before starting the server:

- `PROXY_TARGET_URL` — full target API URL
- `PROXY_API_KEY` — secret key used by the target host
- `PROXY_PROVIDER` — optional provider hint: `anthropic`, `openai`, or `huggingface`
- `PROXY_AUTH_HEADER` — header name for the key (default: `Authorization`)
- `PROXY_AUTH_PREFIX` — prefix before the key (default: `Bearer`)
- `PORT` — optional local server port (default: `3000`)

Common provider URLs:
- Anthropic: `https://api.anthropic.com/v1/messages`
- OpenAI: `https://api.openai.com/v1/chat/completions`
- Hugging Face: `https://api-inference.huggingface.co/models/<model>`

> Important: open the app through `http://localhost:3000`, not by opening `Sage-ui.html` directly from the file system or using VS Code Live Preview. The browser UI must reach the Node proxy at `localhost:3000`.

Example:

```powershell
$env:PROXY_TARGET_URL = 'https://api.anthropic.com/v1/messages'
$env:PROXY_API_KEY = 'your-secret-key'
$env:PROXY_PROVIDER = 'anthropic'
$env:PORT = '3000'
npm start
```

## Start

```powershell
cd "c:\Users\jvick\Documents\Sage-AI"
npm start
```

Open `http://localhost:3000` in your browser.

## Notes

- The browser app sends requests to the configured proxy endpoint, so the target API does not need CORS.
- In the sidebar, you can select Anthropic, OpenAI, or Hugging Face.
- You can also edit the proxy endpoint URL directly from the sidebar and the app will save it.
- The proxy can auto-translate Claude-style payloads for OpenAI when `PROXY_PROVIDER=openai`.
- For `anthropic`, the payload is forwarded directly.
- For unsupported providers, the server forwards the request as-is, so the target API must accept the same JSON structure.
