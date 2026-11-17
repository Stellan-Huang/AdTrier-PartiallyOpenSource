# Video generation and composition

## Runtime path

The generation layer is independent of the SaaS upload/payment workflow. Its main entry point is `generateAd(script, brief, options)`.

1. `compileAdSpec` converts the structured script into timed scenes.
2. `synthesizeVoice` generates one voiceover track for the script.
3. `resolveScene` converts each shot into a Seedance plan using the visual direction, action, entry/exit guidance, product role, and selected asset.
4. `generateSceneMedia` prepares scene jobs, submits tasks, and polls them concurrently.
5. `composeAd` downloads scene media and voiceover, normalizes scene clips, concatenates the timeline, mixes audio, and burns captions with FFmpeg.
6. `validateAd` runs deterministic checks and can request multimodal review.

## Seedance reference roles

The provider adapter handles a model-specific constraint:

- Mini and 2.5 use `reference_image` for reference-to-video.
- Pro Fast is coerced to `first_frame` because that tier does not support the same reference-image mode.

The preview tier is resolved by `SEEDANCE_PREVIEW_TIER`; production generation uses the Mini tier in the current implementation.

## Composition behavior

- Preview composition targets 720×1280; production composition targets 1080×1920.
- The target timeline defaults to 15 seconds.
- Voiceover is synthesized as a whole-script track.
- Captions are generated as ASS subtitles and burned with FFmpeg.
- Background music and SFX are optional. Empty local audio folders are treated as a valid silent configuration.
- Audio duration is resolved from provider metadata, `ffprobe`/`ffmpeg`, or an MP3 header estimate.

## Required configuration

| Variable | Purpose |
|---|---|
| `SEEDANCE_2_5_API` | Seedance 2.5 preview tier |
| `SEEDANCE_2_0_MINI_API` | Seedance Mini preview tier |
| `SEEDANCE_1_0_PRO_FAST_API` | Seedance Pro Fast preview tier |
| `SEEDANCE_PREVIEW_TIER` | `2.5`, `mini`, or `pro-fast` |
| `SEED_TTS_2_0_API` | Seed TTS 2.0 API key |
| `SEED_TTS_APP_ID`, `SEED_TTS_ACCESS_KEY` | Legacy TTS authentication pair |
| `PUBLIC_PRODUCT_IMAGE_URL` | Publicly fetchable image used by the optional example |
| `COMPOSE_BGM` | Set to `0` to disable local BGM mixing |

A working system FFmpeg installation is required for composition. The source can optionally use `ffmpeg-static` if you install it separately, but it is not included as a mandatory dependency.

## Cost and data warning

Live TTS and video calls can incur provider charges. Prompts and referenced media are sent to the configured provider. Use synthetic or approved assets when evaluating the example.

