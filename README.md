# AdTrier Engine --- Research Edition

> A research-oriented presentation of the staged AI video-ad generation
> engine behind **AdTrier**, an early-access product for cross-border
> e-commerce sellers.

**Live product:** <https://adtrier.com>\
**Product demo:** The live demo is available directly on the website
landing page.

## Product in brief

**Give us your product. We'll make the ad.**

AdTrier turns a seller's product information and available assets into a
short-form video advertisement, combining creative concepts, a script,
and generated visuals. The product is designed to remove the need for
manual editing and complicated production workflows.

The live product is in Early Access. Its public landing page describes a
cinematic 15-second ad workflow, with no editing required. New users
receive welcome credits, and usage is credit-based rather than
subscription-based.

## What this project demonstrates

The Research Edition focuses on the engineering ideas behind the
generation pipeline:

-   **Product Intelligence:** extract, normalize, and understand product
    information from text and media.
-   **Creative Planning:** build a creative brief, generate candidate
    concepts, select a direction, and expand it into a
    production-oriented script.
-   **Specification-driven generation:** compile creative decisions into
    a structured ad specification before media generation.
-   **Multimodal media production:** generate scene media, synthesize
    voiceover, prepare captions and audio, and compose the final video
    with FFmpeg.
-   **Quality control:** combine deterministic checks with optional
    multimodal review, then apply bounded and targeted repair where
    appropriate.
-   **Execution provenance:** retain stage versions, input hashes, model
    and prompt metadata, latency, usage, and normalized errors.

The central idea is to separate deterministic engineering rules from
model-based creative decisions. Models handle tasks that benefit from
semantic generation; explicit contracts and validation rules keep the
pipeline constrained and inspectable.

## Pipeline at a glance

``` text
Product Input
    |
    v
Extraction & Normalization
    |
    v
Product Intelligence
    |
    v
Creative Brief
    |
    v
Concept Generation -> Selection -> Script Expansion
    |
    v
Ad Specification (AdSpec)
    |
    v
Scene Media + Voiceover + Captions + Audio
    |
    v
FFmpeg Composition
    |
    v
QA & Bounded Repair
    |
    v
Final Video
```

## Engineering highlights

### Capability-based model assignment

The AI capability registry assigns model tiers by task:

  Capability group                       Default tier
  -------------------------------------- --------------
  Text, image, and video understanding   Lite
  Initial creative generation            Lite
  Creative selection                     Pro
  Script expansion                       Pro
  Ad validation                          Pro

This is stage-aware model allocation through an explicit capability
registry. It should not be confused with a generic autonomous router or
an automatic cross-provider fallback chain. Per-call overrides are
available for controlled evaluation and debugging.

### Failure containment and quality gates

The generation flow uses bounded recovery rather than unbounded retries.
Technical batch failures can be retried within defined limits; eligible
scene-level hard failures can trigger targeted scene regeneration.
Composition, audio, and duration problems are treated separately from
scene-media problems. The pipeline can fail closed instead of silently
replacing a failed generated scene with an unrelated static asset.

### Traceability

Stage results carry provenance such as a run ID, stage version,
generation time, and stable input hash. AI call records capture
capability, provider, model, prompt version, status, latency, usage, and
classified errors. This makes individual stages easier to inspect,
compare, and debug.

## Product and commercialization context

The production product is designed around a low-friction, pay-as-you-go
workflow:

-   Welcome credits help new users try the product.
-   Credit packs replace recurring monthly subscriptions.
-   A watermarked preview lets users inspect the result before unlocking
    the final deliverable.
-   Creem is used for payment checkout.
-   Resend supports email OTP verification and result delivery.
-   Failed-generation handling follows a refund policy.

These details explain the product's commercial design. The Research
Edition is intentionally focused on the generation engine and does
**not** expose production credentials, real user records, payment
transactions, OTP/session data, credit ledgers, or transactional email
operations.

## Agent-assisted engineering process

The project was developed with a specification-first workflow:
architecture PRDs, Rules, and explicit technical boundaries were used to
coordinate implementation. MCP, CLI tools, and Skills supported
development-agent orchestration; automated test review was combined with
human confirmation and rework.

This describes the **software development workflow**, not a claim that
the deployed product contains a general-purpose autonomous MCP Agent
runtime.

## Technology context

The product and source snapshot use the following technologies and
services:

-   Next.js, React, and TypeScript for the application.
-   Supabase-managed PostgreSQL in the production architecture; the
    source snapshot expresses database access through Prisma's
    PostgreSQL datasource.
-   Volcengine model services for product understanding, creative tasks,
    and Seedance-based video generation.
-   Text-to-speech for voiceover generation.
-   FFmpeg for media inspection and composition.
-   Creem and Resend for production payment and email workflows.

The Research Edition narrows the scope to the engine and its
reproducible engineering concepts. Production-only integrations and
sensitive configuration are excluded or represented through safe
boundaries and adapters.

## Scope and limitations

This repository is an engine-focused research presentation, not a full
export of the commercial SaaS product. It is intended to help readers
understand the architecture, stage boundaries, model responsibilities,
media pipeline, and quality-control strategy.

The documented Lite/Pro mapping is capability-based. It does not imply
unrestricted dynamic routing, automatic provider failover, or unlimited
self-healing. Recovery is bounded and tied to specific failure classes.

## Further documentation

-   [Project Overview](docs/PROJECT_OVERVIEW.md)
-   [Architecture](docs/ARCHITECTURE.md)
-   [Pipeline Design](docs/PIPELINE_DESIGN.md)
-   [Agent Workflow](docs/AGENT_WORKFLOW.md)
-   [Engineering Decisions](docs/ENGINEERING_DECISIONS.md)

## License

A license has not yet been selected. Until a license is added, do not
assume that this repository grants permission for reuse or
redistribution.
