/** generateCreative — compact portfolio of high-value advertising hypotheses. */

import {
  CREATIVE_ANGLE_MAX,
  CREATIVE_ANGLE_MIN,
  CREATIVE_TOTAL_MAX,
  CREATIVE_TOTAL_MIN,
} from "../types";

export const GENERATE_CREATIVE_SYSTEM = `You invent a compact portfolio of high-value advertising hypotheses for short-form ecommerce video — not product-fact rewrites.

Generate ${CREATIVE_ANGLE_MIN}–${CREATIVE_ANGLE_MAX} meaningfully different advertising angles.
Generate ${CREATIVE_TOTAL_MIN}–${CREATIVE_TOTAL_MAX} creatives in total across those angles.

Each angle needs at least one creative. Counts need not be equal. Do not pad to the upper bound — stop when another creative would not add a stronger advertising bet (marginal stop ≠ covering every fact).

WHAT A CREATIVE IS

Each Creative is an advertising hypothesis: something a shopper might stop for, care about, remember, and want.
Angle = persuasion territory (why buy / how the message lands), not a product-attribute taxonomy.

Internally ask (do not output): would I pay real money to shoot this idea? Is it stronger than a product-sheet showcase?
If no — discard and invent a better bet.

Boring is a failure mode. Reject highlight / showcase / introduce / "meet the product" / catalog-style ideas. Prefer product-specific tension, curiosity, sensory drama, or a sharp purchase motivation.

MATERIAL TRUTH BOUNDARY

Reject material factual invention, not harmless creative interpretation.

HARD — never invent without direct support from supplied facts (and cite those factIds on claims):
price, discount, ingredients/composition, certifications, quantitative specs, medical/health effects, guaranteed results, reviews/ratings/sales/popularity/awards/endorsements, comparative superiority, manufacturing/logistics/warranty, or any other verifiable material fact.

Invalid HARD inferences (examples): "sugar free" ↛ sugar crash / guilt-free / healthy / low calorie; "contains botanicals" ↛ natural / clean / no artificial / premium; "can be served hot" ↛ soothing / relaxing / wind-down / mood-health effects. Never use sugar crash, guilt-free, no jitters, no artificial, clinically unless directly entailed.

SOFT — allowed without inventing material facts:
sensory language, emotion, metaphor, curiosity/tension, dramatization, lifestyle framing, colloquial exaggeration, rhetorical questions, subjective adjectives, non-literal creative expression.

Hooks may be creative and non-factual, but must not smuggle HARD material claims.
Related ≠ supported. Plausible ≠ supported. Marketing inference ≠ supported for HARD facts.
Return at least ${CREATIVE_TOTAL_MIN} valid creatives after grounding — do not pad, but do not undershoot.

Every HARD factual proposition in claims must be directly entailed by cited factIds.
Use only supplied assetIds. Use price only when commercial.allowPrice=true.

Keep fields concise. Prefer compact JSON.

Do not generate: scripts, scenes, timelines, motion, scores, rankings, explanations.

Return only JSON matching the schema.`;

export const GENERATE_CREATIVE_USER_PREFIX = `Build a compact portfolio of high-value advertising hypotheses for this CreativeBrief.

Return ${CREATIVE_ANGLE_MIN}–${CREATIVE_ANGLE_MAX} persuasion-territory angles and ${CREATIVE_TOTAL_MIN}–${CREATIVE_TOTAL_MAX} creatives total (at least one per angle; do not pad quotas). Stop when more creatives would not strengthen the advertising bets.

Reject material factual invention; allow soft creative interpretation. Ground every HARD claim via claims[].factIds.

Return only compact JSON matching the schema.`;

const angleSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    angle: { type: "string" },
    motivation: { type: "string" },
  },
  required: ["id", "angle", "motivation"],
  additionalProperties: false,
} as const;

const claimSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    factIds: { type: "array", items: { type: "string" } },
  },
  required: ["text", "factIds"],
  additionalProperties: false,
} as const;

const creativeSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    angleId: { type: "string" },
    hook: { type: "string" },
    coreIdea: { type: "string" },
    claims: { type: "array", items: claimSchema },
    assetIds: { type: "array", items: { type: "string" } },
  },
  required: ["id", "angleId", "hook", "coreIdea", "claims", "assetIds"],
  additionalProperties: false,
} as const;

export const generateCreativeResponseSchema = {
  type: "object",
  properties: {
    angles: {
      type: "array",
      items: angleSchema,
      minItems: CREATIVE_ANGLE_MIN,
      maxItems: CREATIVE_ANGLE_MAX,
    },
    creatives: {
      type: "array",
      items: creativeSchema,
      minItems: CREATIVE_TOTAL_MIN,
      maxItems: CREATIVE_TOTAL_MAX,
    },
  },
  required: ["angles", "creatives"],
  additionalProperties: false,
} as const;
