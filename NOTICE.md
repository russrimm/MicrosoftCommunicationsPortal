# Notice

## Microsoft Code Sharing Disclaimer

This software is provided by Microsoft Corporation as a **sample/reference
implementation** and is shared under the MIT License.

**IMPORTANT:**

- This project is **not an official Microsoft product or service**.
- It is **not supported** by Microsoft Support.
- It is provided **"AS IS"** without warranty of any kind, express or implied.
- Microsoft makes **no guarantees** about the availability, reliability, or
  suitability of this code for any particular purpose.
- Use of this software is at your **own risk**.

## Intended Use

This portal is intended as a reference architecture and accelerator to help
customers build their own unified Microsoft communications dashboard. It
demonstrates patterns for:

- Proxying Microsoft public APIs and Azure Management APIs (Release Plans, RSS
  feeds, Azure Resource Manager endpoints)
- Authenticating with Microsoft Graph and Azure Resource Manager using managed
  identity or the client credentials flow
- Aggregating multiple Microsoft update streams into a single UI
- Optional AI-powered summarization of announcements
- Security hardening (nonce-based CSP, allow-list HTML sanitization, rate limiting,
  SSRF-resistant redirect following)

## Trademarks

This project may contain trademarks or logos for projects, products, or
services. Authorized use of Microsoft trademarks or logos is subject to and
must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks).
Use of Microsoft trademarks or logos in modified versions of this project must
not cause confusion or imply Microsoft sponsorship.

## Third-Party Notices

This project uses the following open-source dependency:

| Package | License |
|---------|---------|
| [dotenv](https://github.com/motdotla/dotenv) | BSD-2-Clause |

All Microsoft product icons included in the `/public/` directory are the
property of Microsoft Corporation and are used here solely for the purpose of
identifying Microsoft products and services within this tool.
