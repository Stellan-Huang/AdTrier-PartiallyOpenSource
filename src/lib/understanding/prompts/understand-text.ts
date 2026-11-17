/** Prompt + JSON schema for text modality (v2 — slim). */

export const UNDERSTAND_TEXT_SYSTEM = `You extract advertising-safe product facts and cautious inferences from structured listing text.
Rules:
- Only state what is explicitly supported by the provided text/commercial fields.
- Every fact MUST include sourceText copied from the input (verbatim substring).
- Do NOT invent ingredients, prices, certifications, or audience claims.
- Put audience / use-case / purchase-motivation guesses ONLY in inferences, never in facts.
- Inferences are optional creative hints, not constraints — prefer direct product facts; never treat inferences as required claims or hard requirements for ads.
- Prefer short, atomic statements. Return at most 8 facts.
- Each inference category (possibleAudiences, possibleUseCases, possiblePurchaseMotivations) has at most 2 items.
- Use confidence 0–1 reflecting how directly the source supports the statement.
- fact ids: fact_001, fact_002, …; inference ids: inf_001, …
- Set usableAsAdClaim=true only when the fact is advertising-safe to state as a claim (still requires sourceText).
- Do NOT return a separate claims array.
- User audience / notes / instructions are NOT in this payload and must never appear as facts.`;

export const UNDERSTAND_TEXT_USER_PREFIX = `Extract at most 8 facts (with usableAsAdClaim) and cautious inferences (≤2 per category) from this normalized product text payload.
Inferences are optional creative hints, not constraints — prioritize direct product facts.
Return JSON matching the schema.`;

const factItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    statement: { type: "string" },
    type: { type: "string" },
    source: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["text", "commercial"] },
        field: { type: "string" },
      },
      required: ["kind", "field"],
      additionalProperties: false,
    },
    sourceText: { type: "string" },
    confidence: { type: "number" },
    usableAsAdClaim: { type: "boolean" },
  },
  required: [
    "id",
    "statement",
    "type",
    "source",
    "sourceText",
    "confidence",
    "usableAsAdClaim",
  ],
  additionalProperties: false,
} as const;

const inferenceItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    statement: { type: "string" },
    type: {
      type: "string",
      enum: ["audience", "use_case", "purchase_motivation", "other"],
    },
    basedOnFactIds: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: ["id", "statement", "type", "basedOnFactIds", "confidence"],
  additionalProperties: false,
} as const;

export const understandTextResponseSchema = {
  type: "object",
  properties: {
    product: {
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
      },
      required: ["name", "brand", "category"],
      additionalProperties: false,
    },
    facts: {
      type: "array",
      items: factItemSchema,
      maxItems: 8,
    },
    inferences: {
      type: "object",
      properties: {
        possibleAudiences: {
          type: "array",
          items: inferenceItemSchema,
          maxItems: 2,
        },
        possibleUseCases: {
          type: "array",
          items: inferenceItemSchema,
          maxItems: 2,
        },
        possiblePurchaseMotivations: {
          type: "array",
          items: inferenceItemSchema,
          maxItems: 2,
        },
      },
      required: [
        "possibleAudiences",
        "possibleUseCases",
        "possiblePurchaseMotivations",
      ],
      additionalProperties: false,
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["product", "facts", "inferences", "warnings"],
  additionalProperties: false,
} as const;
