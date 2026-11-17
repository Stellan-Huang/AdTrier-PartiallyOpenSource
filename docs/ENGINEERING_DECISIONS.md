# Engineering Decisions

## 1. Use a staged pipeline instead of a single end-to-end prompt

Product understanding, creative planning, script expansion, media
generation, and QA have different inputs and failure modes. Separating
them makes intermediate results inspectable and gives each stage a
clearer contract.

## 2. Normalize product facts before creative generation

Creative quality depends on the reliability of product information.
Normalization and Product Intelligence establish a structured
representation before the system asks models to propose advertising
concepts.

## 3. Separate ideation, selection, and script expansion

Generating candidates, choosing a direction, and expanding a script are
different reasoning tasks. Keeping them separate makes model
responsibility explicit and allows each capability to be evaluated
independently.

## 4. Compile creative output into an AdSpec

Free-form scripts are not a sufficiently stable interface for a
media-generation pipeline. AdSpec creates a structured boundary between
creative reasoning and deterministic production operations.

## 5. Assign model tiers by capability

The registry assigns Lite to product understanding and initial creative
generation, and Pro to selection, script expansion, and ad validation.
This is a deliberate capability mapping, not an unrestricted dynamic
router or automatic cross-provider fallback mechanism.

## 6. Keep deterministic checks outside model judgment

Structural requirements such as scene presence, timing, duration, and
required media should be checked with deterministic rules where
possible. Models are reserved for semantic or visual judgments that are
difficult to encode as fixed rules.

## 7. Bound retries and repair scope

Repeated generation can increase cost without guaranteeing better
results. Recovery is therefore limited by failure type, with targeted
scene repair for eligible media-level issues and separate handling for
composition-level problems.

## 8. Record provenance for inspection

Run IDs, stage versions, input hashes, prompt versions, model
identifiers, usage, latency, and normalized errors make pipeline
behavior easier to reproduce and debug.

## 9. Separate the engine from commercial fulfillment

The live product needs authentication, credits, checkout, OTP, email
delivery, and refund handling. These are essential product capabilities,
but they are not the central research contribution of the generation
engine. The Research Edition excludes sensitive production data and
operational credentials.

## 10. Be precise about Agent claims

MCP, CLI, Skills, and the Test Agent belong to the AI-assisted software
development workflow. They should not be described as a general-purpose
Agent runtime inside the deployed product unless such a runtime is
independently implemented and documented.
