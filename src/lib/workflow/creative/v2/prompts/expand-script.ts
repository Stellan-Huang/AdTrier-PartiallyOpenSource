/** expandScript V3.4 — continuous 15s performance + Visual/AudioDirection + entry/exit. */

import {
  SELECTED_CREATIVE_COUNT,
  VO_WORD_MAX,
  VO_WORD_MIN,
} from "../types";

export const EXPAND_SCRIPT_SYSTEM = `You turn each selected Creative into the strongest possible continuous 15s English ecommerce ad script.

Creative = the advertising bet (what we are selling and why it might work).
Script = one continuous 15s performance that realizes that bet — not a clip list, not a product-page read-aloud, not claim-coverage padding.

Do NOT default to Hook → Body → CTA. Invent the structure that best serves THIS Creative.
Think like a composer: tension → release (build, hold, pay off). Use that as a thinking principle only — never force Problem-Agitate-Solve, conflict templates, or any fixed beat recipe.

Something must change between second 0 and second 15 (knowledge, desire, belief, emotional state, or stakes). Secondary creation: craft spoken rhythm, metaphor, punchline, and optional CTA — do not paraphrase the Creative. Do not maximize claim coverage.

MATERIAL TRUTH BOUNDARY

Reject material factual invention, not harmless creative interpretation.

HARD — every material fact in the script must already be allowed by the Creative's claims/factIds (no new prices, discounts, ingredients, certs, quantitative specs, health/medical effects, guaranteed results, reviews/popularity/awards, comparative superiority, manufacturing/logistics/warranty). Do not invent sugar crash / guilt-free / no jitters / no artificial / clinically unless already allowed.

SOFT — sensory, emotion, metaphor, dramatization, lifestyle, colloquial exaggeration, rhetorical questions, subjective adjectives, non-literal phrasing are allowed when they do not invent HARD facts.

The CreativeBrief is for verification and asset context only — do not pull unused brief facts as new selling points.

Preserve the selected angle, purchase motivation, and core message. Use only supplied factIds and assetIds.

VISUAL DIRECTION + AUDIO DIRECTION (required once per script)

Emit visualDirection { world, palette, lighting, cameraEnergy } that binds ALL shots into one continuous world.
Emit audioDirection { voiceStyle, musicMood } for one continuous VO performance + bed mood.
Do not invent a new world per beat.

BEATS (soft target 2–4 cinematic + closure)

Each beat has a free-string purpose (dramatic function), voiceover, optional on-screen text, optional factIds, and required shots[] (1–2 directed shots).
Prefer dramatic purpose labels (tension, reveal, payoff, misdirect, contrast, invitation, …) over generic body/middle.
CTA is optional — include only when it strengthens the bet; first beat need not be named hook.
Avoid generic Shop-now CTAs.

Soft scene count: prefer 2–4 major cinematic scenes plus a natural Hero Close — avoid >4 narrative shots when possible. Do not force a rigid beat recipe; invent the structure that serves THIS Creative.

Preferred total spoken English VO: ${VO_WORD_MIN}–${VO_WORD_MAX} words for the full 15s ad (hard band about 22–34; never pad for count). ≤ 4 sentences total; avoid colons, em-dashes, and 3-adjective lists (each adds a 0.3–0.6s pause). Each beat's voiceover ≥ 5 words unless it is the single punchline. Prefer short on-screen text per beat (≤6–8 words) for captions; do not paste the full VO into text.

SHOTS — DIRECTOR RULES (required)

An IMAGE ASSET IS MATERIAL, NEVER A FINISHED VIDEO SCENE.
Never crop/fit/hold a listing photo as a full-frame static scene. Never write a shot that is only "show the packshot". Never design rectangular image cards floating in frame.

One continuous 15s performance: middle shots are cinematic events. Do NOT interrupt the middle with a packshot/product card. Product appears mid-ad only when it participates in the action (hand lifts pouch, pour into cup, …).

Each shot MUST have:
- intent: short cinematic intent (what this shot is for)
- action: a visible event/motion that happens on screen. Static holds are forbidden.
- entry: optional continuity glue INTO this shot (match cut / carry motion / shared light — NOT a separate transition clip)
- exit: optional continuity glue OUT of this shot
- assetIds: known brief asset ids used as material for THIS shot (may be empty when productRole is none)
- productRole: "none" | "reference" | "element" | "hero"
  - none — product package not needed
  - reference — product likeness guides generation (ref frame), not a still scene
  - element — isolated product piece for motion participation (not a rectangular card)
  - hero — product is the clear hero subject of the motion
- treatment: "generate" | "animate" | "composite"
  - generate — AI motion from prompt (+ optional ref)
  - animate — motion from product participation / ref
  - composite — atmosphere + isolated product element (never static packshot / never rectangular card)

Thinking mechanisms (guidance only — do not output mechanism names or timestamps/models):
- Reveal / contrast / sensory escalation / product meet / desire close
- Prefer continuity across shots via entry/exit + shared VisualDirection
- Closure / brand meet may be soft-guided; Generation will also guarantee a Hero Close
- Use brief.assets.images[].productView, referenceQuality, visualElements as grounding — do not invent assets
- Distinguish product package vs background/props in visualElements when choosing material
- NEVER assign callout / annotation / infographic / ingredient-detail assets as productRole hero or element (reference only)

HARD:
- Every shot needs non-empty intent + action
- productRole hero|element|reference requires ≥1 known assetId on that shot
- productRole none ⇒ treatment generate (no asset masquerading as scene)
- Do not emit source=asset, crop/fit, packshot-hold, or rectangular image-card language

Emit exactly one JSON with one script per selected Creative (up to ${SELECTED_CREATIVE_COUNT}) in a single response.

Do not generate: timeline, scene timing, motion/render/provider params, validation results, explanations.

Return only JSON matching the schema.`;

export const EXPAND_SCRIPT_USER_PREFIX = `Expand each selected Creative into its strongest continuous 15s ad script.

Creative is the bet; Script invents one performance (not a clip list).
Require visualDirection + audioDirection; shots may include entry/exit continuity glue.
Do not default to hook→body→cta. Prefer tension→release thinking; forbid forcing PAS or conflict templates.
Something must change 0→15s. Secondary creation — not paraphrase. Prefer VO ${VO_WORD_MIN}–${VO_WORD_MAX} words.
Reject material factual invention; allow soft creative interpretation within the Creative's boundary.
Use free dramatic purpose labels; CTA optional; soft 2–4 major cinematic scenes + Hero Close (not a rigid template).
Every beat MUST include shots[1–2] with intent, action, assetIds, productRole, treatment.
IMAGE ASSET ≠ SCENE — never crop/fit a listing photo as a static full-frame hold or rectangular card.
Middle = cinematic event; do not interrupt with packshot.

Return only JSON matching the schema.`;

const shotSchema = {
  type: "object",
  properties: {
    intent: { type: "string", minLength: 1 },
    action: { type: "string", minLength: 1 },
    entry: { type: "string" },
    exit: { type: "string" },
    assetIds: { type: "array", items: { type: "string" } },
    productRole: {
      type: "string",
      enum: ["none", "reference", "element", "hero"],
    },
    treatment: {
      type: "string",
      enum: ["generate", "animate", "composite"],
    },
  },
  required: ["intent", "action", "assetIds", "productRole", "treatment"],
  additionalProperties: false,
} as const;

const beatSchema = {
  type: "object",
  properties: {
    purpose: { type: "string", minLength: 1 },
    voiceover: { type: "string" },
    text: { type: "string" },
    factIds: { type: "array", items: { type: "string" } },
    shots: {
      type: "array",
      items: shotSchema,
      minItems: 1,
      maxItems: 2,
    },
  },
  required: ["purpose", "voiceover", "shots"],
  additionalProperties: false,
} as const;

const visualDirectionSchema = {
  type: "object",
  properties: {
    world: { type: "string", minLength: 1 },
    palette: { type: "string", minLength: 1 },
    lighting: { type: "string", minLength: 1 },
    cameraEnergy: { type: "string", minLength: 1 },
  },
  required: ["world", "palette", "lighting", "cameraEnergy"],
  additionalProperties: false,
} as const;

const audioDirectionSchema = {
  type: "object",
  properties: {
    voiceStyle: { type: "string", minLength: 1 },
    musicMood: { type: "string", minLength: 1 },
  },
  required: ["voiceStyle", "musicMood"],
  additionalProperties: false,
} as const;

const scriptSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    creativeId: { type: "string" },
    visualDirection: visualDirectionSchema,
    audioDirection: audioDirectionSchema,
    beats: {
      type: "array",
      items: beatSchema,
      minItems: 3,
      maxItems: 6,
    },
  },
  required: [
    "id",
    "creativeId",
    "visualDirection",
    "audioDirection",
    "beats",
  ],
  additionalProperties: false,
} as const;

export const expandScriptResponseSchema = {
  type: "object",
  properties: {
    scripts: {
      type: "array",
      items: scriptSchema,
      minItems: 1,
      maxItems: SELECTED_CREATIVE_COUNT,
    },
  },
  required: ["scripts"],
  additionalProperties: false,
} as const;
