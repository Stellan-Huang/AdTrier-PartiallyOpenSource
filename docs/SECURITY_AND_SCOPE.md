# Security and scope boundary

## What was removed

The source archive included a hosted SaaS application around the engine. The research edition excludes:

- Next.js pages, components, middleware, and API routes;
- Prisma schema, database connection code, and production persistence;
- user accounts, sessions, OTP flows, job access tokens, and email delivery;
- credit balances, ledgers, checkout, payment webhooks, refunds, and provider product IDs;
- production deployment settings, site-password gate, and internal support/legal contact details;
- production upload/storage orchestration and the branded watermark/unlock flow;
- `.agents`, `.cursor`, and payment-provider-specific IDE Skills;
- scripts and fixtures tied to a real third-party product listing or local developer workspace.

## Why these files are not included

They are not required to inspect the core product-understanding, creative, or media-generation algorithms. Keeping them would expose business operations and deployment details while making the public project harder to run independently.

## Agent/MCP clarification

The archive's agent-related files were IDE instructions and payment-integration Skills. They were not a runtime Agent system that orchestrates the advertising pipeline, and they did not provide a general MCP execution layer. Those files are therefore not included. The current repository demonstrates AI capability orchestration inside the application engine, not runtime MCP orchestration.

## Synthetic sample data

The included sample product and sample image are synthetic. No third-party product listing, customer data, email, payment record, or production snapshot is included.

## Before publishing

- Review the source and run a secret scanner.
- Choose and add a license.
- Confirm rights to any new product media, fonts, music, and sound effects.
- Keep `.env`, `.data/`, `output/`, and real customer assets out of Git.

