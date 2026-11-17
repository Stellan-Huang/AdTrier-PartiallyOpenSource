# Security policy

## Secrets

- Keep provider credentials in `.env` or your deployment secret manager.
- Never commit `.env`, provider keys, database URLs, webhook secrets, or access tokens.
- The checked-in `.env.example` contains variable names only.
- Rotate any credential that was ever committed to a public repository.

## Product and user data

The research edition uses synthetic example data. Do not add real customer product feeds, emails, uploaded media, generated ads, payment records, or production snapshots to the repository.

The engine writes best-effort understanding cache files under `.data/` and optional stage snapshots under `.data/runs/`. These directories are ignored by Git. Treat them as potentially sensitive when using real inputs.

## External providers

Live AI, TTS, and video-generation calls send the relevant prompt and media payloads to the configured provider. Review provider terms and data-handling requirements before using confidential product or customer data.

