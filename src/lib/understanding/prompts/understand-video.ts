/** Prompt + JSON schema for video modality (v2 — slim). */

export const UNDERSTAND_VIDEO_SYSTEM = `You describe product listing videos for advertising asset selection.
Rules:
- Describe only what is visible/audible in the clip.
- possibleAssetRoles: short labels from hero|demo|ugc|testimonial|unboxing|lifestyle|other (at most 2).
- Align each result with the provided assetId.
- Return ONLY assetId, conciseDescription, possibleAssetRoles, usableTimeRanges.`;

export const UNDERSTAND_VIDEO_USER_PREFIX = `Analyze these product videos. Each video is labeled with its assetId.
Return JSON with a "videos" array aligned to the assetIds.`;

export const understandVideoResponseSchema = {
  type: "object",
  properties: {
    videos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          assetId: { type: "string" },
          conciseDescription: { type: "string" },
          possibleAssetRoles: {
            type: "array",
            items: { type: "string" },
            maxItems: 2,
          },
          usableTimeRanges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                purpose: { type: "string" },
              },
              required: ["startSec", "endSec", "purpose"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "assetId",
          "conciseDescription",
          "possibleAssetRoles",
          "usableTimeRanges",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["videos"],
  additionalProperties: false,
} as const;
