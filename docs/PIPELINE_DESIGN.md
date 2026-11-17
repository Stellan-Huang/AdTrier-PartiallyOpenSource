# Pipeline Design

## 1. Overview

The pipeline converts a product brief into a short-form video
advertisement through explicit stages:

1.  Extract and normalize product inputs.
2.  Build Product Intelligence.
3.  Create a creative brief and candidate directions.
4.  Select and expand a creative direction into a script.
5.  Compile the script into an AdSpec.
6.  Generate scene media and audio.
7.  Compose and validate the final video.

Each stage should have a clear input contract, output contract, and
failure boundary.

## 2. Product Intelligence

The Product Intelligence stage consolidates product information from
structured fields and available media. Text, images, and video can
contribute evidence to the product representation.

The goal is not to generate advertising copy immediately. It is to
establish a normalized, reusable understanding of the product so that
later creative stages can work from consistent facts.

## 3. Creative Planning

The creative workflow separates ideation from selection and script
expansion:

-   **Creative Brief:** translates product understanding and user
    context into a creative task definition.
-   **Generate Creative:** produces candidate concepts and angles.
-   **Select Creative:** evaluates candidates and chooses a direction.
-   **Expand Script:** develops the chosen direction into a more
    detailed script with scene-level intent.

This decomposition improves inspectability and allows different model
capabilities to be assigned to different tasks.

## 4. AdSpec compilation

The selected script is compiled into a structured advertising
specification. The AdSpec is the boundary between creative reasoning and
media production.

It provides explicit scene-level information for downstream generation
and composition. This reduces the need for the media layer to
reinterpret free-form prose.

## 5. Media generation

The generation layer coordinates:

-   Scene-level video generation.
-   Voiceover synthesis.
-   Captions and on-screen text.
-   Background music and sound effects.
-   Media preparation and final composition.

Seedance is used for video generation in the production pipeline,
text-to-speech supplies voiceover, and FFmpeg handles deterministic
audio/video processing and composition.

## 6. Quality assurance

Quality assurance combines deterministic validation with optional
model-based visual review.

Examples of deterministic checks include:

-   Required composed video and voiceover are present.
-   Generated scene count is consistent with the specification.
-   Scene timing is valid and does not contain prohibited overlaps.
-   Required product references are present for hero scenes.
-   Final composed duration remains within the configured acceptance
    window.

Multimodal review can inspect visual properties such as whether the
product is visible in a key hero frame.

## 7. Bounded recovery and cost control

Recovery is deliberately limited by failure type:

-   Technical batch failures may receive a bounded retry.
-   Eligible hard scene-media failures may trigger targeted scene
    regeneration.
-   Composition, audio, and duration issues are handled as
    composition-level problems rather than automatically triggering
    another expensive scene-generation call.
-   Repeated failures can stop the run instead of silently substituting
    an unrelated static asset.

This is a practical form of failure containment and cost control. It is
more precise than describing the system as having unlimited
self-healing.

## 8. Model allocation

The capability registry assigns Lite to product understanding and
initial creative generation, while Pro is used for creative selection,
script expansion, and ad validation.

This allocation reflects the different reasoning needs of each stage. It
is an explicit registry mapping, with controlled per-call overrides for
evaluation and debugging.
