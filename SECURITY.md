# Security

## Reporting Security Issues

If you discover a security vulnerability in this project, please report it
responsibly. **Do not open a public GitHub issue.**

Instead, please email [russ.rimmerman@microsoft.com](mailto:russ.rimmerman@microsoft.com)
with a description of the issue, steps to reproduce, and any relevant details.

## Security Considerations

- **Credentials**: Never commit `.env` files or secrets to source control. The
  `.gitignore` is configured to exclude these files.
- **Managed Identity**: When hosting on Azure, prefer managed identity
  (`USE_MANAGED_IDENTITY=true`) over a client secret. This eliminates the need
  to store, rotate, or risk leaking a long-lived credential. See
  [README → Setup → Option A](README.md#setup).
- **Client Secret Rotation**: If you use the client-secret auth path, rotate
  your Entra ID client secret before it expires (check the expiration you set
  during app registration).
- **Network Binding**: The server binds to `127.0.0.1` (localhost only) by
  default and refuses to bind to a non-loopback host unless `ALLOW_REMOTE_BIND=true`
  is set. If you expose it on a network, run behind an authenticated reverse
  proxy with TLS (nginx, Azure App Service, Azure Front Door, etc.) — the server
  does not terminate TLS itself.
- **Graph Permissions**: The app uses application-level permissions
  (`ServiceMessage.Read.All`, `ServiceHealth.Read.All`) — grant only what is
  needed and restrict access via Conditional Access policies where possible.

## Implemented Protections

### Content Security Policy (CSP)

All HTML responses include a strict CSP header. Inline `<script>` tags are
authorized via a per-request cryptographic nonce (`script-src 'self' 'nonce-…'`);
`'unsafe-inline'` is **not** used. No inline event handlers (`onclick`, `onchange`,
etc.) appear in the markup — all user-facing interactions use a `data-act` event-
delegation system in `static/util.js`. Additional directives restrict resources:

- `frame-ancestors 'none'` + `X-Frame-Options: DENY` (clickjacking prevention)
- `base-uri 'none'` (base-tag hijack prevention)
- `form-action 'none'` (no forms submit to external targets)
- `object-src 'none'`, `frame-src 'none'`, `media-src 'none'`, `worker-src 'none'`

### HTML Sanitization

All untrusted HTML from upstream feeds (Azure/M365 RSS descriptions, Microsoft
Graph Message Center message bodies) is sanitized through a single hardened
**allow-list** sanitizer in `static/util.js`. It parses content with `DOMParser`
(which does not execute scripts), keeps only an explicit set of safe tags and
attributes, strips everything else — including `<script>`, `<style>`, `<iframe>`,
`<svg>`, `<math>`, `<template>`, `<noscript>`, event-handler attributes,
`javascript:` / `data:` / `blob:` URLs, and `style` attributes. This resists
mutation-XSS far better than a deny-list approach. Links are forced to
`target="_blank" rel="noopener noreferrer"`.

### Rate Limiting

Every API endpoint is rate-limited on a per-IP fixed-window counter. When running
behind a reverse proxy, set `TRUST_PROXY=true` so the limiter reads the client IP
from the first `X-Forwarded-For` entry (otherwise it keys on the socket address,
which collapses all clients to one bucket). Current limits:

| Endpoint group | Limit |
|---|---|
| AI (`/api/summarize`) | 5 requests / minute |
| AI (`/api/impact-digest`) | 10 requests / minute |
| Graph + RSS (`/api/messagecenter`, `/api/servicehealth`, `/api/m365updates`, `/api/azureupdates`) | 60 requests / minute |
| Proxy (`/proxy`) | 600 requests / minute |

### SSRF / Token-Leak Prevention

- The Graph bearer token is **never** sent to any host other than
  `graph.microsoft.com`. If a Graph `@odata.nextLink` points at a different host,
  the request is rejected.
- Outbound redirect-following in the RSS and release-plan fetchers is restricted to
  `*.microsoft.com` and `*.azure.com` over HTTPS. Redirects to any other host are
  rejected with a logged error.

### Admin Endpoint

The `/api/empty-products` endpoint (GET and DELETE) is restricted to loopback
addresses (`127.0.0.1`, `::1`). When `ADMIN_TOKEN` is set in `.env`, a bearer
token is additionally required for both read and mutate operations, compared
using `crypto.timingSafeEqual` to prevent timing side-channels.

### Input Validation

- **Request body cap**: JSON POST bodies are limited to 1 MB.
- **Prototype pollution guard**: The JSON body parser strips `__proto__`,
  `constructor`, and `prototype` keys via a reviver function before they reach
  application code.
- **Path traversal protection**: `/static/` and `/public/` file-serving rejects
  `..`, `\`, and any resolved path that escapes the intended root directory.

### Response Headers

All responses include `X-Content-Type-Options: nosniff`. HTML responses add
`Referrer-Policy: no-referrer` and the full CSP header described above.
