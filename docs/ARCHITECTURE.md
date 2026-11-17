# Architecture

## 1. Architectural approach

AdTrier uses a staged pipeline. Each stage has a defined responsibility
and exchanges structured data with the next stage. The design aims to
keep model-based reasoning separate from deterministic transformation,
validation, and media operations.

``` text
Product Input
  |
  v
Extraction / Normalization
  |
  v
Product Intelligence
  |
  v
Creative Planning
  |-- Creative Brief
  |-- Candidate Generation
  |-- Selection
  `-- Script Expansion
  |
  v
AdSpec Compilation
  |
  v
Media Generation
  |-- Scene Video
  |-- Voiceover
  |-- Captions
  `-- Music / Sound Effects
  |
  v
FFmpeg Composition
  |
  v
Quality Assurance
  |
  v
Delivery
```

## 2. Main layers

### Input and normalization

The input layer accepts product information and available media.
Extraction and normalization convert inconsistent source fields into a
predictable product representation. This reduces the amount of ambiguity
passed into later model calls.

### Product Intelligence

Product Intelligence combines normalized fields with text, image, and
video understanding. Its output is a structured product understanding
that later creative stages can reference.

### Creative Planning

Creative Planning is split into distinct responsibilities:

-   Build a creative brief from product understanding and user context.
-   Generate candidate creative directions.
-   Select a direction according to the task's requirements.
-   Expand the selected direction into a scene-oriented script.

This separation makes it possible to inspect and test the intermediate
creative decisions instead of treating the entire creative process as
one opaque model response.

### Specification and generation

The script is compiled into an AdSpec that describes the scenes and
their production requirements. Media generation then creates the
required scene assets and audio. FFmpeg is responsible for deterministic
media operations such as composition and media inspection.

### Quality assurance

Quality assurance combines deterministic checks with optional multimodal
review. Deterministic checks cover structural conditions such as missing
media, scene timing, and final duration. Model-based review can inspect
visual conditions that are difficult to express as simple rules.

## 3. AI execution layer

An explicit capability registry maps each AI capability to a provider,
model tier, reasoning level, and prompt version.

The current capability assignment is:

  Capability                    Default tier
  ----------------------------- --------------
  Product text understanding    Lite
  Product image understanding   Lite
  Product video understanding   Lite
  Initial creative generation   Lite
  Creative selection            Pro
  Script expansion              Pro
  Ad validation                 Pro

The registry makes model responsibility visible and reviewable. Debug
overrides can change provider, model, or reasoning level for a specific
call without mutating the shared registry.

The implementation should be described as capability-based model
assignment, not as a generic automatic fallback router. The runner
normalizes provider errors and records usage; it does not imply
unrestricted cross-provider failover.

## 4. Execution provenance

Stage results carry lineage information:

-   `stageVersion`: version of the stage implementation or contract.
-   `runId`: identifier for a workflow or debug run.
-   `inputHash`: stable hash of the upstream input.
-   `generatedAt`: timestamp for the result.

AI call records can include capability, provider, model, prompt version,
status, latency, token usage, cache status, and normalized error
information.

This metadata supports debugging, comparisons across prompt or model
revisions, and inspection of where a pipeline run failed.

## 5. Production services and research boundary

The production product also includes application, persistence,
authentication, credits, payment, and email-delivery concerns. The
product architecture is described as using Next.js, Supabase-managed
PostgreSQL, and FFmpeg; the extracted source snapshot models PostgreSQL
access through Prisma.

The Research Edition intentionally excludes production secrets and
sensitive operational data. It focuses on the engine's stage boundaries
and generation workflow rather than reproducing the full commercial
service.
