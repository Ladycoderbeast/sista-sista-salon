# Security Policy

Thanks for helping keep Sista Sista Salon & Spa safe.

## Supported Versions
We maintain the `main` branch. If you find a security issue, please report it privately.

## Reporting a Vulnerability
- **Do not** open a public GitHub issue.
- Email: **info@hanatechnologies.org** with the subject: `[SECURITY] Sista Sista`
- Include: steps to reproduce, affected files/URLs, screenshots or PoC if possible.

We’ll acknowledge your report within **72 hours** and aim to provide a remediation plan or fix within **7 business days**, depending on severity.

## Scope / Notes
- This is a static PWA with no server-side secrets in this repo.
- User PINs are stored locally on the device using salted hashes.
- If you discover a way to bypass auth or offline protections, please share details privately as above.
