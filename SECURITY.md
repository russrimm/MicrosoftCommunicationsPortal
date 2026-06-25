# Security

## Reporting Security Issues

If you discover a security vulnerability in this project, please report it
responsibly. **Do not open a public GitHub issue.**

Instead, please email [russ.rimmerman@microsoft.com](mailto:russ.rimmerman@microsoft.com)
with a description of the issue, steps to reproduce, and any relevant details.

## Security Considerations

- **Credentials**: Never commit `.env` files or secrets to source control. The
  `.gitignore` is configured to exclude these files.
- **Client Secret Rotation**: Rotate your Entra ID client secret before it
  expires (check the expiration you set during app registration).
- **Network Binding**: The server binds to `127.0.0.1` (localhost only) by
  default. If you expose it on a network, consider adding authentication and
  running behind a reverse proxy with TLS.
- **Graph Permissions**: The app uses application-level permissions
  (`ServiceMessage.Read.All`, `ServiceHealth.Read.All`) — grant only what is
  needed and restrict access via Conditional Access policies where possible.
