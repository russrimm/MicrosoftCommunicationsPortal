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
  your Entra ID client secret before it expires — note the expiration date you
  chose during app registration.
- **Network Binding**: The server binds to `127.0.0.1` (localhost only) by
  default and refuses to bind to a non-loopback host unless `ALLOW_REMOTE_BIND=true`
  is set. If you expose it on a network, run behind an authenticated reverse
  proxy with TLS (nginx, Azure App Service, Azure Front Door, etc.) — the server
  does not terminate TLS itself.
- **Graph Permissions**: The app uses application-level permissions
  (`ServiceMessage.Read.All`, `ServiceHealth.Read.All`) — grant only what is
  needed and restrict access via Conditional Access policies where possible.

## Implemented Protections

For the complete list of implemented security features — including CSP with
nonce, allow-list HTML sanitization, per-IP rate limiting, SSRF/redirect
safety, injection prevention, transport security, response headers, AI-specific
defenses, credential management, and supply chain minimization — see
[README → Security hardening](README.md#security-hardening).
