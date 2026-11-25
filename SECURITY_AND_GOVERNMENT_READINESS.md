# CrisisBridge — Security, Privacy & Government Readiness Plan

## Current status

CrisisBridge is an academic prototype, **not Government of India approved, certified, or cleared for live emergency dispatch**. This package includes demo-level hardening for the local LAN relay. It is not a production security certification and must not be used as the sole emergency channel.

## Security changes in this package

- Local relay API requires a random bearer token printed once in the server terminal; the browser asks for it and stores it in the current tab's `sessionStorage`.
- API requests no longer use wildcard `Access-Control-Allow-Origin`.
- Basic origin checks, lightweight per-IP request limiting, JSON payload limits, path traversal checks, and response security headers.
- Relay data directory and JSON files are created with restrictive local file permissions where the operating system supports them.
- API errors avoid returning stack traces or internal file details.
- Data remains on the host computer / local network unless a user exports it or the operator configures another service.

## Important remaining security gaps

These are still demo limitations and must be resolved before any real deployment:

1. **Demo login is not secure authentication.** Demo accounts and passwords are present in frontend JavaScript and browser storage. Anyone with access to the source/browser profile can inspect or alter them. Never enter real personal data or real emergency recordings.
2. **The LAN relay uses one shared demo token.** It does not implement individual identities, role-based server authorization, revocation, or per-user audit trails. Anyone who obtains the token can read/write relay records.
3. **LAN traffic is not encrypted.** The prototype uses HTTP, not HTTPS. Use only a controlled demo network. Do not expose port 5000 to the public internet or an untrusted Wi-Fi network.
4. **JSON files are not a resilient production database.** There is no tested crash recovery, backup rotation, tamper-evident audit, replication, or disaster recovery.
5. **Client-side data is not encrypted at rest.** LocalStorage and IndexedDB are accessible to the browser profile and may be copied from the device. Voice and location data are sensitive.
6. **Security controls are not independently audited.** The basic request limiter is not DDoS protection; origin checks are not authentication; a bearer token is not a replacement for a secure identity system.
7. **Offline translation, cross-device mesh networking, background delivery, and all device/browser combinations are not validated.** The app must not imply a report was received by authority until an explicit acknowledgement is recorded.

## Required production security architecture

- Move identity and authorization to a trusted backend; use strong password hashing (Argon2id or scrypt), short-lived sessions, CSRF protections where relevant, rate limits, account recovery, MFA for authority roles, and least-privilege role-based authorization.
- Use per-device credentials, rotation/revocation, mutual authentication where practical, and TLS for IP networking. For Bluetooth/peer-to-peer links, use authenticated encryption and replay protection.
- Encrypt sensitive stored data at rest using managed keys; separate keys from data; minimize collection; establish retention/deletion rules and secure backup handling.
- Keep an append-only audit trail for authority actions, incident assignment, access to sensitive records, exports and deletions. Protect logs from tampering and avoid logging audio or unnecessary personal data.
- Validate every field server-side; use schema validation, upload/audio size limits, malware/content checks where applicable, quotas, idempotency keys, duplicate handling and safe concurrency controls.
- Define outage behaviour explicitly: local queued reports, unique incident IDs, delivery acknowledgements, retries, duplicate merging, stale-data warnings, and conflict resolution after reconnection.
- Conduct threat modelling, dependency review, static analysis, penetration testing, privacy impact assessment, accessibility review, backup/restore drills, load tests and field trials with emergency-management professionals.
- Create an incident response plan, security contact, vulnerability reporting process, retention schedule, consent/privacy notice, user rights process and operator training.

## Privacy-by-design requirements

Collect only the data required to respond to an incident. Tell users what is recorded, why it is needed, who can access it, how long it is kept, and how deletion/complaints work. Obtain appropriate consent where required, with a separate and clear notice for voice and location data. Do not use real citizen recordings, addresses, phone numbers or health details in the academic demo. Protect exported backups as sensitive files and delete test data after demonstrations.

India's Digital Personal Data Protection Act, 2023 and the notified Digital Personal Data Protection Rules, 2025 are relevant starting points for legal review. Applicability, commencement timelines, exemptions, and the exact obligations for the eventual operator must be assessed by qualified counsel. CERT-In's directions and incident-reporting requirements should also be reviewed for the eventual operating entity and deployment.

Official starting points:
- MeitY — Digital Personal Data Protection Act, 2023: https://www.meity.gov.in/content/digital-personal-data-protection-act-2023-dpdp-act
- MeitY — Digital Personal Data Protection Rules, 2025: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025-
- CERT-In — Directions under Section 70B: https://www.cert-in.org.in/Directions70B.jsp
- NDMA SACHET — official disaster alert platform (reference for interoperability and operational context): https://sachet.ndma.gov.in/

## Government adoption / approval pathway

There is no code change that automatically grants Government of India approval. First identify a sponsoring department/agency and a clearly scoped pilot use case. Prepare a technical proposal, architecture, data-flow diagram, threat model, privacy assessment, accessibility and language plan, test evidence, field-trial results, maintenance/support plan, costs, and incident-response plan. Then approach the relevant state disaster management authority / district administration and the appropriate national or state programme for formal review. Follow the specific procurement, security audit, hosting, interoperability and certification requirements that the sponsoring authority sets. Do not display Government emblems or claim endorsement without written authorization.

## Safe demo checklist

- Use fictional demo data only.
- Run on a trusted private LAN; do not port-forward or expose the server publicly.
- Keep the relay token private; restart the server to rotate the automatically generated token.
- Test offline operation, report acknowledgement, voice playback, duplicate reports, storage quota, app reload, device restart and recovery after LAN reconnection.
- Keep an alternative emergency channel available. In India, use official emergency services when available; this prototype is not a substitute for them.
