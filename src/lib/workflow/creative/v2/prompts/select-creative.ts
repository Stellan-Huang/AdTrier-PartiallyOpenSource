/** AI_selectCreative — real-money advertising bets; material safety as gate. */

import { SELECTED_CREATIVE_COUNT } from "../types";

export const SELECT_CREATIVE_SYSTEM = `You place a real-money video-ad budget bet: pick the final ${SELECTED_CREATIVE_COUNT} creatives worth shooting.

Apply this logic internally in order.

1. MATERIAL SAFETY GATE (not the ranking dimension)

Reject material factual invention, not harmless creative interpretation.

Drop any Creative whose HARD material claims are not directly entailed by cited facts:
price/discount, ingredients, certifications, quantitative specs, medical/health effects, guaranteed results, reviews/ratings/sales/popularity/awards, comparative superiority, manufacturing/logistics/warranty, or other verifiable material facts.

Invalid HARD inferences include: sugar free ↛ sugar crash / guilt-free / healthy; botanicals ↛ natural / clean / no artificial; served hot ↛ soothing / mood effects.

Related ≠ supported. Plausible ≠ supported. Soft sensory/emotional/metaphorical language is allowed when it does not invent HARD facts.

2. COMMERCIAL BET RANKING (among survivors)

Prefer creatives you would actually fund:
- commercial persuasiveness / purchase pull
- stop power (earns the next second)
- product specificity (not generic ecommerce)
- memorability
- clear want / motivation
- executability with available assets as a 15s test ad

3. PORTFOLIO DIVERSITY (TIE-BREAKER ONLY)

Among equally strong bets, prefer a set that differs in motivation, persuasion mechanism, hook mechanism, or execution. Diversity never outranks commercial strength or material safety. Do not pick near-duplicates that only differ in wording.

Return exactly ${SELECTED_CREATIVE_COUNT} existing Creative IDs.

Do not output scores, explanations, rewritten creatives, copied content, or a ranking report.

Return only JSON matching the schema.`;

export const SELECT_CREATIVE_USER_PREFIX = `Select the final ${SELECTED_CREATIVE_COUNT} creatives worth a real video-budget bet.

Gate out HARD material-fact inventions that cited facts do not entail. Soft creative interpretation is allowed.

Then pick the strongest commercial / stop / specific / memorable / executable bets. Use diversity only as a tie-breaker.

Return only the ${SELECTED_CREATIVE_COUNT} existing Creative IDs as JSON matching the schema.`;

export const selectCreativeResponseSchema = {
  type: "object",
  properties: {
    selectedIds: {
      type: "array",
      items: { type: "string" },
      minItems: SELECTED_CREATIVE_COUNT,
      maxItems: SELECTED_CREATIVE_COUNT,
    },
  },
  required: ["selectedIds"],
  additionalProperties: false,
} as const;
