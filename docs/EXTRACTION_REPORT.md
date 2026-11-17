# Extraction report

## Source and retained scope

The uploaded archive contained 323 files in the extracted project tree. This research edition retains the engine-focused modules and replaces application-specific adapters with a small portable entry point.

| Area | Treatment |
|---|---|
| AI registry, runner, provider adapters | Retained |
| Product normalization | Retained; product fixture replaced with synthetic sample |
| Text/image/video understanding | Retained |
| Creative V2 | Retained |
| Script compilation and video generation | Retained |
| FFmpeg media helpers and QA | Retained |
| Unit tests | Retained and adjusted to remove production-domain/fixture references |
| Next.js app, API routes, Prisma, auth, OTP, billing, payments, email | Excluded |
| Production uploads, branded watermark/unlock, internal deployment config | Excluded |
| IDE-specific agent/payment Skills and live commercial fixtures | Excluded |

## Resulting package

- 78 TypeScript implementation files
- 11 TypeScript test files
- 126 passing unit tests in the offline validation run
- English README and technical docs, plus a Chinese overview
- Synthetic sample product and image
- `.env.example` with variable names only
- CI workflow and release checklist

## Validation boundary

The unit suite was run offline with mocked provider calls. No live model, TTS, or Seedance request was made, so provider credentials, current quotas, and real-world output quality were not validated.

A TypeScript static check passed using the globally available compiler and a temporary declaration shim for the optional Google SDK. The npm registry was not reachable during packaging, so the dependency installation itself was not verified here; run `npm install`, `npm run typecheck`, and `npm test` in a normal Node/npm environment before publishing.

## Publication decision still required

No license was selected. Add the license you intend to grant before describing the repository as an officially licensed open-source release.

