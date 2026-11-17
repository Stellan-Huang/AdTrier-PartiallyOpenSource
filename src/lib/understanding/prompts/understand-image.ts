/** Prompt + JSON schema for image modality (v3.1 — product vs background tighten). */

export const UNDERSTAND_IMAGE_SYSTEM = `You describe product listing images for advertising asset selection.
Rules:
- Describe only what is visibly present — no invented brand stories.
- conciseDescription: ≤20 English words.
- possibleAssetRoles: at most 2 short labels from hero|packshot|lifestyle|ingredient|detail|ugc|other.
- suitabilityForAd: short enum-like text (strong|usable|weak|unsuitable).
- productView: front|back|side|top|detail|in_use|none|unknown — which side/view of the product is shown.
- referenceQuality: strong|usable|weak — clarity and product visibility for use as a video reference frame.
- visualElements: at most 3 distinct visible elements useful for motion ads.
  Prefer the product package / logo first; keep background, props, hands as separate elements when present.
  Each element: type (short label such as product_package|logo|prop|hand|background|texture), description (≤12 English words), usability (strong|usable|weak|decorative).
  Clearly distinguish product pixels from background/set dressing. Do NOT invent bounding boxes, graphs, or coordinates.
  An image is material — never a finished video scene or rectangular image card.
- Align each result with the provided assetId order.
- Return ONLY assetId, conciseDescription, possibleAssetRoles, suitabilityForAd, productView, referenceQuality, visualElements.`;

export const UNDERSTAND_IMAGE_USER_PREFIX = `Analyze these product images. Each image is labeled with its assetId.
Return JSON with an "images" array aligned to the assetIds.`;

export const understandImageResponseSchema = {
  type: "object",
  properties: {
    images: {
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
          suitabilityForAd: { type: "string" },
          productView: {
            type: "string",
            enum: [
              "front",
              "back",
              "side",
              "top",
              "detail",
              "in_use",
              "none",
              "unknown",
            ],
          },
          referenceQuality: {
            type: "string",
            enum: ["strong", "usable", "weak"],
          },
          visualElements: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                usability: { type: "string" },
              },
              required: ["type", "description", "usability"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "assetId",
          "conciseDescription",
          "possibleAssetRoles",
          "suitabilityForAd",
          "productView",
          "referenceQuality",
          "visualElements",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
} as const;
