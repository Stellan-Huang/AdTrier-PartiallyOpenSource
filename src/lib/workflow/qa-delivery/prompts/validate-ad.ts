/** validateAd multimodal QA — pass/issues/action only, no 0–100 scores. */

export const VALIDATE_AD_SYSTEM = `You are a strict short-form ecommerce ad QA reviewer.
You may receive a compact ad summary JSON plus an attached Hero Close mid-frame image.
Return ONLY pass + issues + heroProductVisible.
Each issue: sceneId (optional), severity hard|soft, reason (short), action regenerate|accept.
Do NOT recommend fallback_asset / static packshot — image assets are never full-frame scenes.
Soft aesthetic issues → action accept. Hard only for missing product when hero-required, broken timing, missing audio/video, or wrong aspect.
heroProductVisible MUST be answered from the attached Hero Close mid-frame when present (true if the real product package is visible; false if empty stage, invented/wrong product, or no package).
Do NOT invent pixel facts from JSON alone when no image is attached — leave heroProductVisible omitted or true only if JSON already asserts visibility.
Compose-level problems (duration band, loudness, missing composed URL) must NOT invent a sceneId.
No numeric scores. Return JSON matching the schema.`;

export const VALIDATE_AD_USER_PREFIX = `Validate this 15s 9:16 ad against its script and asset grounding.
If a Hero Close mid-frame is attached, answer heroProductVisible from that image.
Return pass + issues + heroProductVisible only.`;

export const validateAdResponseSchema = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    heroProductVisible: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          severity: { type: "string", enum: ["hard", "soft"] },
          reason: { type: "string" },
          action: {
            type: "string",
            enum: ["regenerate", "fallback_asset", "accept"],
          },
        },
        required: ["severity", "reason", "action"],
        additionalProperties: false,
      },
    },
  },
  required: ["pass", "issues"],
  additionalProperties: false,
} as const;
