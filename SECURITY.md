# Security Policy

## Supported versions

Security fixes are applied to the current `main` release line. Upgrade to the latest published stable image before reporting a suspected product defect unless doing so would worsen an incident.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email `adhit.boys1@gmail.com` with the subject `VPN Manager security report`.

Include a clear description, affected version or image tag, deployment details, reproduction steps or proof of concept, impact assessment, and any suggested remediation. Remove JWTs, VPN tokens, registration keys, Agent tokens, private keys, certificates, customer data, and internal IP addresses that are not necessary to demonstrate the issue.

An acknowledgement is targeted within seven days. A report will be assessed, reproduced where possible, and handled privately until a fix or mitigation is available. Coordinated disclosure is preferred.

## Secret exposure

If a `JWT_SECRET`, `VPN_TOKEN`, `NODE_REGISTRATION_KEY`, `AGENT_SECRET_TOKEN`, private key, certificate authority key, or database backup is exposed, treat it as compromised. Restrict access, rotate the exposed secret, invalidate affected sessions or re-register affected nodes as appropriate, and review logs and audit history. Do not paste exposed values into public issues.
