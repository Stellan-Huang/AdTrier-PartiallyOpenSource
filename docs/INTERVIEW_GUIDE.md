# Interview guide: how to explain the engineering

Use this document as a factual guide to the code in this repository. Keep the distinction between implemented behavior, external-provider behavior, and future work clear.

## 1. What is the system?

It is a multi-stage AI advertising-generation engine. It transforms a product payload and media references into a fact-grounded creative brief, structured scripts, generated scene media, and a composed short-form video.

The important contribution is the orchestration and the boundaries between deterministic processing and model-driven work—not a single prompt that asks a model to make an entire advertisement.

## 2. Why separate Product Intelligence from Creative?

Product Intelligence first extracts and organizes evidence:

- facts retain source references;
- inferences remain separate from facts;
- image/video observations are separate from text claims;
- execution failures are recorded rather than hidden.

Creative Brief construction then selects only facts marked usable as advertising claims. This reduces the chance that a plausible inference is accidentally presented as a verified product property.

## 3. Why use a capability registry?

Different tasks have different requirements. The registry maps each capability to a provider, model tier, reasoning level, and prompt version. Lightweight extraction and candidate generation use the Lite tier; selection and script expansion use the Pro tier in the checked-in defaults.

The registry is explicit configuration, not a learned router. Provider failover is not automatic.

## 4. How is reliability handled?

- Input cleanup and validation are deterministic.
- Model responses use structured output schemas.
- Post-generation sanitizers check fact IDs, asset IDs, shot roles, and script constraints.
- Stage results include status, errors, usage, and provenance.
- Cache keys include prompt/model identity and canonicalized inputs.
- Provider retries are bounded; the system does not fabricate a successful result after a failure.

## 5. What is interesting about video generation?

The model produces a structured script, but the application compiles exact scene timing in code. TTS is generated as a whole-script track. Seedance tasks are submitted in a batch and polled concurrently. FFmpeg owns the final media composition, including normalization, concatenation, audio mixing, and captions.

This separates narrative intent from timeline arithmetic and media muxing.

## 6. What should not be overstated?

- The included tests are predominantly mocked/unit tests; they are not a published performance benchmark.
- The public edition does not include the production database, authentication, payments, uploads, or hosted SaaS runtime.
- The archived Agent-related files were IDE instructions and billing Skills, not a runtime MCP orchestration engine.
- Semantic trimming is conditional: the default flow skips it for candidate pools of 18 or fewer.
- The checked-in model registry defaults to Volcengine. The Gemini adapter is retained as an alternate implementation, not the default route.

## Suggested concise description

"I designed a staged AI media-generation pipeline that separates deterministic product normalization and claim validation from multimodal understanding and creative generation. A capability registry assigns model tiers by task; structured outputs are sanitized and recorded with provenance. The generation layer compiles scripts into timed scenes, fans out asynchronous video tasks, and uses FFmpeg for deterministic composition and QA."

