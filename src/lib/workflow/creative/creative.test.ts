import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiRunner, AiUsageRecord, RunCapabilityResult } from "@/lib/ai";
import { CREATIVE_PROMPT_VERSION, DEFAULT_AI_MODEL } from "@/lib/ai";
import type { ProductUnderstanding } from "@/lib/understanding";
import {
  buildCreativeBrief,
  createCreativeFlow,
  createCreativePlan,
  CREATIVE_ANGLE_MAX,
  CREATIVE_ANGLE_MIN,
  CREATIVE_TOTAL_MAX,
  CREATIVE_TOTAL_MIN,
  CREATIVE_V2_STAGE_VERSION,
  TRIM_EMBED_SKIP_MAX,
  expandScript,
  generateCreative,
  repairSelectedIds,
  SELECTED_CREATIVE_COUNT,
  selectCreative,
  trimCreative,
  type Creative,
  type CreativeAngle,
  type CreativeBrief,
  type Script,
} from "./index";
import { validateGenerateCreativeOutput } from "./v2/generateCreative";
import { countWords } from "./v2/expandScript";

function mockOk<T>(
  data: T,
  capability: AiUsageRecord["capability"],
  promptVersion = CREATIVE_PROMPT_VERSION,
): RunCapabilityResult<T> {
  return {
    data,
    usage: {
      capability,
      provider: "volcengine",
      model: DEFAULT_AI_MODEL,
      promptVersion,
      status: "ok",
      latencyMs: 2,
      inputTokens: 10,
      outputTokens: 20,
      cached: false,
    },
  };
}

const ASSET_A = "img_hero";
const ASSET_B = "img_detail";

function baseUnderstanding(
  overrides: Partial<ProductUnderstanding> = {},
): ProductUnderstanding {
  return {
    version: 1,
    jobId: "job_creative_test",
    normalizedVersion: 1,
    product: { name: "Lemon Tea", brand: null, category: "Tea" },
    userContext: {
      audience: "Health-conscious tea drinkers",
      instructions: "Keep it playful",
    },
    facts: [
      {
        id: "fact_001",
        statement: "The tea is sugar free.",
        type: "dietary_claim",
        source: { kind: "text", field: "bullets" },
        sourceText: "Sugar Free",
        confidence: 1,
        usableAsAdClaim: true,
      },
      {
        id: "fact_002",
        statement: "The tea is vegan.",
        type: "dietary_claim",
        source: { kind: "text", field: "bullets" },
        sourceText: "Vegan",
        confidence: 1,
        usableAsAdClaim: true,
      },
      {
        id: "fact_price",
        statement: "Costs $14.09",
        type: "price",
        source: { kind: "commercial", field: "listPrice" },
        sourceText: "14.09",
        confidence: 0.2,
        usableAsAdClaim: false,
      },
    ],
    inferences: {
      possibleAudiences: [
        {
          id: "inf_001",
          statement: "AI-inferred audience must not overwrite user",
          type: "audience",
          basedOnFactIds: ["fact_001"],
          confidence: 0.6,
        },
      ],
      possibleUseCases: [
        {
          id: "inf_002",
          statement: "Afternoon iced tea ritual",
          type: "use_case",
          basedOnFactIds: ["fact_001"],
          confidence: 0.5,
        },
      ],
      possiblePurchaseMotivations: [
        {
          id: "inf_003",
          statement: "Want flavor without sugar",
          type: "purchase_motivation",
          basedOnFactIds: ["fact_001"],
          confidence: 0.7,
        },
      ],
    },
    assets: {
      images: [
        {
          assetId: ASSET_A,
          conciseDescription: "Hero pouch shot",
          possibleAssetRoles: ["hero", "packshot"],
          suitabilityForAd: "high",
          productView: "front",
          referenceQuality: "strong",
          visualElements: [
            {
              type: "package",
              description: "Front of lemon tea pouch",
              usability: "hero",
            },
          ],
        },
        {
          assetId: ASSET_B,
          conciseDescription: "Loose leaf detail",
          possibleAssetRoles: ["detail", "ingredient"],
          suitabilityForAd: "medium",
          productView: "detail",
          referenceQuality: "usable",
          visualElements: [
            {
              type: "ingredient",
              description: "Loose leaf close-up",
              usability: "detail",
            },
          ],
        },
      ],
      videos: [],
    },
    warnings: [
      "Commercial price fields are marked invalid or missing; price cannot be used in ad claims.",
      "Upstream listPrice is invalid (integer-cents ambiguity)",
    ],
    validation: {
      readyForCreativeStage: true,
      missingFields: [],
      invalidFields: [],
      modalityStatus: { text: "ok", images: "ok", videos: "skipped" },
    },
    ...overrides,
  };
}

const FIXTURE_ANGLE_COUNT = 4;
const FIXTURE_PER_ANGLE = 3;

function makeAngles(): CreativeAngle[] {
  return Array.from({ length: FIXTURE_ANGLE_COUNT }, (_, i) => ({
    id: `angle_${String(i + 1).padStart(2, "0")}`,
    angle: `Angle ${i + 1} sugar-free ritual`,
    motivation: "Want flavor without sugar",
  }));
}

/** Unique token bags so trim Jaccard does not collapse the whole pool. */
const HOOK_LEXICON = [
  "midnight porch swing sipping citrus steam",
  "office desk reset with citrus steam",
  "picnic blanket lemon blossom ritual",
  "gym bag refill clean energy brew",
  "rainy window comfort cup ceremony",
  "road trip thermos bright leaf moment",
  "kitchen counter morning spark routine",
];

function makeCreatives(angles: CreativeAngle[]): Creative[] {
  const out: Creative[] = [];
  for (const [ai, a] of angles.entries()) {
    for (let j = 1; j <= FIXTURE_PER_ANGLE; j++) {
      const base = HOOK_LEXICON[ai % HOOK_LEXICON.length];
      out.push({
        id: `${a.id}_c${j}`,
        angleId: a.id,
        hook: `${base} option${j} spin${ai}${j} uniquely phrased`,
        coreIdea: `Core idea for ${a.id} option ${j} with distinct framing`,
        claims: [
          { text: "Sugar free oolong tea", factIds: ["fact_001"] },
          { text: "Vegan friendly", factIds: ["fact_002"] },
        ],
        factIds: ["fact_001", "fact_002"],
        assetIds: [ASSET_A, ASSET_B],
      });
    }
  }
  return out;
}

function voWords(n: number, seed = "sip"): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
}

/** Default shot for test beats — generate unless assets provided. */
function testShot(
  assetIds?: string[],
  overrides?: Partial<{
    intent: string;
    action: string;
    productRole: "none" | "reference" | "element" | "hero";
    treatment: "generate" | "animate" | "composite";
  }>,
) {
  const hasAssets = Boolean(assetIds?.length);
  const productRole =
    overrides?.productRole ?? (hasAssets ? "hero" : "none");
  const treatment =
    overrides?.treatment ??
    (productRole === "none" ? "generate" : "animate");
  return {
    intent: overrides?.intent ?? "Test beat shot",
    action: overrides?.action ?? "Subtle camera push with natural motion",
    assetIds: assetIds ? [...assetIds] : [],
    productRole,
    treatment,
  };
}

const TEST_VD = {
  world: "sunlit kitchen counter",
  palette: "lemon yellow and soft white",
  lighting: "warm morning window light",
  cameraEnergy: "gentle glide",
};
const TEST_AD = {
  voiceStyle: "warm intimate conversational",
  musicMood: "soft bright ambient",
};

function validScripts(selected: Creative[]): Script[] {
  return selected.map((c, i) => ({
    id: `script_${String(i + 1).padStart(2, "0")}`,
    creativeId: c.id,
    visualDirection: { ...TEST_VD },
    audioDirection: { ...TEST_AD },
    beats: [
      {
        purpose: "tension",
        voiceover: voWords(9, `hook${i}`),
        text: "Sugar free",
        factIds: ["fact_001"],
        shots: [
          testShot([ASSET_A], {
            intent: "Hero packshot hold",
            action: "Pouch fills frame with soft push-in",
            productRole: "hero",
            treatment: "animate",
          }),
          testShot([ASSET_A], {
            intent: "Texture detail",
            action: "Camera drifts across pouch print",
            productRole: "element",
            treatment: "composite",
          }),
        ],
      },
      {
        purpose: "reveal",
        voiceover: voWords(10, `body${i}`),
        text: "Vegan oolong",
        factIds: ["fact_002"],
        shots: [
          testShot([ASSET_B], {
            intent: "Steam rise from cup with pouch ref",
            action: "Steam curls upward beside pouch",
            productRole: "reference",
            treatment: "generate",
          }),
        ],
      },
      {
        purpose: "payoff",
        voiceover: voWords(8, `cta${i}`),
        text: "Try it",
        shots: [
          testShot([], {
            intent: "Lifestyle smile no package",
            action: "Warm smile toward camera, no product lock",
            productRole: "none",
            treatment: "generate",
          }),
        ],
      },
    ],
  }));
}

function v2Runner(opts?: {
  gen?: { angles: CreativeAngle[]; creatives: Creative[] };
  selectIds?: string[];
  scripts?: Script[] | "fail";
}): AiRunner {
  const angles = opts?.gen?.angles ?? makeAngles();
  const creatives = opts?.gen?.creatives ?? makeCreatives(angles);
  return {
    async runCapability(capability) {
      if (capability === "generateCreative") {
        return mockOk({ angles, creatives }, "generateCreative");
      }
      if (capability === "selectCreative") {
        const ids =
          opts?.selectIds ??
          creatives.slice(0, SELECTED_CREATIVE_COUNT).map((c) => c.id);
        return mockOk({ selectedIds: ids }, "selectCreative");
      }
      if (capability === "expandScript") {
        if (opts?.scripts === "fail") {
          throw new Error("expand boom");
        }
        const selected = creatives.filter((c) =>
          (opts?.selectIds ?? creatives.slice(0, SELECTED_CREATIVE_COUNT).map((x) => x.id)).includes(
            c.id,
          ),
        );
        const scripts =
          opts?.scripts ??
          validScripts(
            selected.length
              ? selected
              : creatives.slice(0, SELECTED_CREATIVE_COUNT),
          );
        return mockOk({ scripts }, "expandScript");
      }
      throw new Error(`unexpected ${capability}`);
    },
  } as AiRunner;
}

describe("buildCreativeBrief", () => {
  it("sets allowPrice false when warnings mention invalid/missing listPrice", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    assert.equal(brief.jobId, "job_creative_test");
    assert.equal(brief.facts.length, 2);
    assert.equal(
      brief.facts.some((f) => f.id === "fact_price"),
      false,
    );
    assert.equal(brief.commercial.allowPrice, false);
    assert.equal(brief.audience, "Health-conscious tea drinkers");
    assert.equal(brief.instructions, "Keep it playful");
    assert.deepEqual(brief.insights.audiences, [
      "AI-inferred audience must not overwrite user",
    ]);
    assert.equal(brief.assets.images.length, 2);
    assert.equal(brief.assets.images[0].assetId, ASSET_A);
    assert.equal("visibleProduct" in brief.assets.images[0], false);
    assert.equal(brief.assets.images[0].productView, "front");
    assert.equal(brief.assets.images[0].referenceQuality, "strong");
    assert.ok(brief.assets.images[0].visualElements.length >= 1);
    assert.equal(brief.constraints.durationSec, 15);
    assert.equal(brief.constraints.aspectRatio, "9:16");
    assert.equal(brief.constraints.language, "en");
  });

  it("takes audience/instructions from userContext — never AI inferences", () => {
    const brief = buildCreativeBrief(
      baseUnderstanding({
        userContext: { audience: null, instructions: null },
      }),
    );
    assert.equal(brief.audience, undefined);
    assert.equal(brief.instructions, undefined);
    assert.ok(brief.insights.audiences.length >= 1);

    const overridden = buildCreativeBrief(baseUnderstanding(), {
      audience: "Override audience",
      instructions: "Override notes",
    });
    assert.equal(overridden.audience, "Override audience");
    assert.equal(overridden.instructions, "Override notes");
  });

  it("allowPrice true when no price warnings", () => {
    const brief = buildCreativeBrief(
      baseUnderstanding({ warnings: [] }),
    );
    assert.equal(brief.commercial.allowPrice, true);
  });
});

describe("generateCreative range validation", () => {
  it("accepts a well-formed compact pool and derives factIds from claims", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    assert.equal(angles.length, FIXTURE_ANGLE_COUNT);
    assert.equal(creatives.length, FIXTURE_ANGLE_COUNT * FIXTURE_PER_ANGLE);
    const { data, errors } = validateGenerateCreativeOutput(
      { angles, creatives },
      brief,
    );
    assert.equal(errors.length, 0, errors.join("; "));
    assert.ok(data);
    assert.ok(data.creatives.length >= CREATIVE_TOTAL_MIN);
    assert.ok(data.creatives.length <= CREATIVE_TOTAL_MAX);
    assert.ok(data.creatives.every((c) => c.claims.length >= 1));
    assert.deepEqual(data.creatives[0].factIds, ["fact_001", "fact_002"]);
  });

  it("rejects creative with empty claims after unknown factId strip", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    const creatives = makeCreatives(angles).map((c, i) =>
      i === 0
        ? {
            ...c,
            claims: [{ text: "unsupported", factIds: ["fact_missing"] }],
            factIds: [] as string[],
          }
        : c,
    );
    const { data, errors } = validateGenerateCreativeOutput(
      { angles, creatives },
      brief,
    );
    assert.equal(data, null);
    assert.ok(errors.some((e) => /empty\/unknown claim|Expected .* creatives/i.test(e)));
  });

  it("rejects out-of-range angle counts", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles().slice(0, 2);
    const creatives = makeCreatives(makeAngles()).slice(0, 10);
    const { data, errors } = validateGenerateCreativeOutput(
      { angles, creatives },
      brief,
    );
    assert.equal(data, null);
    assert.ok(errors.some((e) => /angles/i.test(e)));
  });

  it("copies PU fact statements into brief unchanged", () => {
    const understanding = baseUnderstanding();
    const brief = buildCreativeBrief(understanding);
    for (const f of understanding.facts.filter((x) => x.usableAsAdClaim)) {
      const bf = brief.facts.find((b) => b.id === f.id);
      assert.ok(bf);
      assert.equal(bf.statement, f.statement);
    }
  });
});

describe("trimCreative (semantic only)", () => {
  it("dedupes similar hooks via Jaccard fallback (no angle quota)", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    // Build >12 so embed skip does not apply when forced jaccard
    const creatives = [
      ...makeCreatives(angles),
      ...makeCreatives(angles).map((c, i) => ({
        ...c,
        id: `${c.id}_extra${i}`,
        hook: `${c.hook} extra variant ${i}`,
      })),
    ].slice(0, 14);
    creatives[1] = {
      ...creatives[1],
      hook: creatives[0].hook,
    };
    const result = await trimCreative(
      { brief, angles, creatives },
      { forceJaccardFallback: true },
    );
    assert.ok(typeof result.shortlist !== "undefined");
    assert.ok(result.warnings.some((w) => /Dedupe|Jaccard/i.test(w)));
    assert.ok(result.shortlist.length < creatives.length);
    assert.equal(result.metrics.embedFallback, "jaccard");
  });

  it("skips embedding when pool ≤ TRIM_EMBED_SKIP_MAX", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    const creatives = makeCreatives(angles); // 12
    assert.ok(creatives.length <= TRIM_EMBED_SKIP_MAX);
    let embedCalls = 0;
    const result = await trimCreative(
      { brief, angles, creatives },
      {
        embedFn: async (texts) => {
          embedCalls += 1;
          return {
            vectors: texts.map(() => [1, 0]),
            model: "mock",
            latencyMs: 1,
            usage: { promptTokens: 1, totalTokens: 1 },
          };
        },
      },
    );
    assert.equal(embedCalls, 0);
    assert.equal(result.shortlist.length, creatives.length);
    assert.equal(result.metrics.embedFallback, "skipped");
  });

  it("hardFilter helper drops empty claims and lexical safety phrases", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    creatives[0] = { ...creatives[0], claims: [], factIds: [] };
    creatives[1] = {
      ...creatives[1],
      hook: "Enjoy a guilt-free afternoon reset",
      claims: [{ text: "guilt-free energy", factIds: ["fact_001"] }],
    };
    const { hardFilterCreatives } = await import("./v2/trimCreative");
    const filtered = hardFilterCreatives({ brief, angles, creatives });
    assert.ok(!filtered.kept.some((c) => c.id === creatives[0].id));
    assert.ok(!filtered.kept.some((c) => c.id === creatives[1].id));
  });

  it("semanticTrim uses mock embed + cosine threshold for pools > TRIM_EMBED_SKIP_MAX", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    // Need >18 creatives so premium/trim path actually embeds.
    const base = [
      ...makeCreatives(angles),
      ...makeCreatives(angles).map((c, i) => ({
        ...c,
        id: `${c.id}_b${i}`,
        hook: `${c.hook} batchB ${i}`,
      })),
      ...makeCreatives(angles).map((c, i) => ({
        ...c,
        id: `${c.id}_c${i}`,
        hook: `${c.hook} batchC ${i}`,
      })),
    ];
    assert.ok(base.length > TRIM_EMBED_SKIP_MAX);
    const dim = 4;
    const result = await trimCreative(
      { brief, angles, creatives: base },
      {
        embedFn: async (texts) => ({
          vectors: texts.map((_, i) => {
            const v = new Array(dim).fill(0);
            const angleIdx = angles.findIndex(
              (a) => a.id === base[i].angleId,
            );
            const firstInAngle = base.findIndex(
              (c) => c.angleId === base[i].angleId,
            );
            v[Math.max(0, angleIdx)] = 1;
            if (i !== firstInAngle) {
              // identical to first in angle → cosine 1
            }
            return v;
          }),
          model: "mock-embed",
          latencyMs: 1,
          usage: { promptTokens: 1, totalTokens: 1 },
        }),
      },
    );
    assert.ok(result.metrics.semanticDuplicateCount >= 1);
    assert.equal(result.metrics.embedFallback, null);
  });
});

describe("selectCreative + repairSelectedIds", () => {
  it("repairs bad/duplicate IDs in code (no second AI)", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    const shortlist = (
      await trimCreative(
        { brief, angles, creatives },
        { forceJaccardFallback: true },
      )
    ).shortlist;
    assert.ok(shortlist.length > SELECTED_CREATIVE_COUNT);

    let selectCalls = 0;
    const runner = {
      async runCapability(capability) {
        if (capability === "selectCreative") {
          selectCalls += 1;
          return mockOk(
            {
              selectedIds: [
                "bogus_id",
                shortlist[0].id,
                shortlist[0].id,
                shortlist[1].id,
              ],
            },
            "selectCreative",
          );
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;

    const result = await selectCreative(
      { brief, shortlist, angles },
      { runner },
    );
    assert.equal(result.status, "ok");
    assert.equal(selectCalls, 1);
    assert.equal(result.data?.selected.length, SELECTED_CREATIVE_COUNT);
    assert.ok(result.data?.warnings.some((w) => /unknown id/i.test(w)));
    assert.ok(result.data?.warnings.some((w) => /duplicate/i.test(w)));
  });

  it("repairSelectedIds tops up from shortlist order", () => {
    const shortlist = makeCreatives(makeAngles()).slice(0, 8);
    const repaired = repairSelectedIds(
      ["nope"],
      shortlist,
      SELECTED_CREATIVE_COUNT,
    );
    assert.equal(repaired.selected.length, SELECTED_CREATIVE_COUNT);
    assert.ok(repaired.warnings.some((w) => /unknown/i.test(w)));
  });
});

describe("expandScript VO / factIds", () => {
  it("fail-closes when VO word count outside hard band (<22 or >34)", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 2);
    const badScripts: Script[] = selected.map((c, i) => ({
      id: `script_${i}`,
      creativeId: c.id,
      visualDirection: { ...TEST_VD },
      audioDirection: { ...TEST_AD },
      beats: [
        {
          purpose: "hook",
          voiceover: voWords(5),
          factIds: ["fact_001"],
          shots: [testShot([ASSET_A])],
        },
        {
          purpose: "body",
          voiceover: voWords(5),
          factIds: ["fact_bogus"],
          shots: [testShot()],
        },
        {
          purpose: "cta",
          voiceover: voWords(5),
          shots: [testShot()],
        },
      ],
    }));
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts: badScripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;

    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "failed");
    assert.ok(result.data?.scripts.length);
    assert.ok(
      result.execution.errors.some((e) => /VO word count/i.test(e.errorMessage)),
    );
    // Unknown factIds stripped
    for (const s of result.data!.scripts) {
      for (const b of s.beats) {
        assert.ok(!(b.factIds ?? []).includes("fact_bogus"));
      }
    }
  });

  it("soft-warns when VO is in soft band (31–34) but keeps status ok", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 1);
    const softScripts: Script[] = [
      {
        id: "script_soft",
        creativeId: selected[0]!.id,
        visualDirection: { ...TEST_VD },
        audioDirection: { ...TEST_AD },
        beats: [
          {
            purpose: "hook",
            voiceover: voWords(12),
            factIds: ["fact_001"],
            shots: [testShot([ASSET_A])],
          },
          { purpose: "body", voiceover: voWords(11), shots: [testShot()] },
          { purpose: "cta", voiceover: voWords(9), shots: [testShot()] },
        ],
      },
    ];
    assert.equal(
      countWords(softScripts[0]!.beats.map((b) => b.voiceover).join(" ")),
      32,
    );
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts: softScripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.scripts.length, 1);
    assert.ok(
      result.data?.warnings.some((w) => /soft warning/i.test(w)),
    );
    assert.equal(result.execution.errors.length, 0);
  });

  it("accepts VO in preferred 24–30 range", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 2);
    const scripts: Script[] = selected.map((c, i) => ({
      id: `script_pref_${i}`,
      creativeId: c.id,
      visualDirection: { ...TEST_VD },
      audioDirection: { ...TEST_AD },
      beats: [
        {
          purpose: "hook",
          voiceover: voWords(9, `hook${i}`),
          factIds: ["fact_001"],
          shots: [testShot([ASSET_A])],
        },
        {
          purpose: "body",
          voiceover: voWords(10, `body${i}`),
          shots: [testShot()],
        },
        {
          purpose: "cta",
          voiceover: voWords(8, `cta${i}`),
          shots: [testShot()],
        },
      ],
    }));
    for (const s of scripts) {
      const n = countWords(s.beats.map((b) => b.voiceover).join(" "));
      assert.ok(n >= 24 && n <= 30, `voWords=${n}`);
    }
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.scripts.length, 2);
    assert.ok(
      !(result.data?.warnings ?? []).some((w) => /VO word count/i.test(w)),
    );
  });
});

describe("expandScript structure V3.4", () => {
  it("accepts free-string dramatic purposes without hook/body/cta triad", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 1);
    const scripts: Script[] = [
      {
        id: "script_drama",
        creativeId: selected[0]!.id,
        visualDirection: { ...TEST_VD },
        audioDirection: { ...TEST_AD },
        beats: [
          {
            purpose: "tension",
            voiceover: voWords(10, "ten"),
            factIds: ["fact_001"],
            shots: [testShot([ASSET_A]), testShot([ASSET_A], { productRole: "element", treatment: "composite" })],
          },
          {
            purpose: "reveal",
            voiceover: voWords(12, "rev"),
            shots: [testShot()],
          },
          {
            purpose: "payoff",
            voiceover: voWords(10, "pay"),
            shots: [testShot()],
          },
        ],
      },
    ];
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.scripts.length, 1);
    assert.deepEqual(
      result.data!.scripts[0]!.beats.map((b) => b.purpose),
      ["tension", "reveal", "payoff"],
    );
  });

  it("allows scripts with no cta purpose", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 1);
    const scripts: Script[] = [
      {
        id: "script_no_cta",
        creativeId: selected[0]!.id,
        visualDirection: { ...TEST_VD },
        audioDirection: { ...TEST_AD },
        beats: [
          {
            purpose: "cold_open",
            voiceover: voWords(11, "open"),
            shots: [testShot(), testShot()],
          },
          {
            purpose: "escalate",
            voiceover: voWords(12, "esc"),
            shots: [testShot()],
          },
          {
            purpose: "soft_land",
            voiceover: voWords(11, "land"),
            shots: [testShot()],
          },
        ],
      },
    ];
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.ok(
      !result.data!.scripts[0]!.beats.some((b) => b.purpose === "cta"),
    );
  });

  it("accepts 3–6 beats and drops scripts with >6 beats", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 2);
    const sixBeats: Script = {
      id: "script_six",
      creativeId: selected[0]!.id,
      visualDirection: { ...TEST_VD },
      audioDirection: { ...TEST_AD },
      beats: [
        { purpose: "a", voiceover: voWords(5, "a"), shots: [testShot()] },
        { purpose: "b", voiceover: voWords(5, "b"), shots: [testShot()] },
        { purpose: "c", voiceover: voWords(5, "c"), shots: [testShot()] },
        { purpose: "d", voiceover: voWords(5, "d"), shots: [testShot()] },
        { purpose: "e", voiceover: voWords(5, "e"), shots: [testShot()] },
        { purpose: "f", voiceover: voWords(5, "f"), shots: [testShot()] },
      ],
    };
    const sevenBeats: Script = {
      id: "script_seven",
      creativeId: selected[1]!.id,
      visualDirection: { ...TEST_VD },
      audioDirection: { ...TEST_AD },
      beats: [
        { purpose: "a", voiceover: voWords(4, "a"), shots: [testShot()] },
        { purpose: "b", voiceover: voWords(4, "b"), shots: [testShot()] },
        { purpose: "c", voiceover: voWords(4, "c"), shots: [testShot()] },
        { purpose: "d", voiceover: voWords(4, "d"), shots: [testShot()] },
        { purpose: "e", voiceover: voWords(4, "e"), shots: [testShot()] },
        { purpose: "f", voiceover: voWords(4, "f"), shots: [testShot()] },
        { purpose: "g", voiceover: voWords(4, "g"), shots: [testShot()] },
      ],
    };
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts: [sixBeats, sevenBeats] }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.scripts.length, 1);
    assert.equal(result.data!.scripts[0]!.beats.length, 6);
    assert.ok(
      result.data?.warnings.some((w) => />6 beats/i.test(w)),
    );
  });

  it("drops unknown creativeId and strips unknown factIds/assetIds", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 1);
    const scripts: Script[] = [
      {
        id: "script_bad_id",
        creativeId: "not_selected",
        visualDirection: { ...TEST_VD },
        audioDirection: { ...TEST_AD },
        beats: [
          {
            purpose: "tension",
            voiceover: voWords(12, "t"),
            shots: [testShot()],
          },
          {
            purpose: "reveal",
            voiceover: voWords(12, "r"),
            shots: [testShot()],
          },
          {
            purpose: "payoff",
            voiceover: voWords(10, "p"),
            shots: [testShot()],
          },
        ],
      },
      {
        id: "script_ok",
        creativeId: selected[0]!.id,
        visualDirection: { ...TEST_VD },
        audioDirection: { ...TEST_AD },
        beats: [
          {
            purpose: "tension",
            voiceover: voWords(12, "t"),
            factIds: ["fact_001", "fact_bogus"],
            shots: [
              testShot([ASSET_A, "asset_bogus"], {
                productRole: "hero",
                treatment: "animate",
              }),
              testShot(),
            ],
          },
          {
            purpose: "reveal",
            voiceover: voWords(12, "r"),
            shots: [testShot()],
          },
          {
            purpose: "payoff",
            voiceover: voWords(10, "p"),
            shots: [testShot()],
          },
        ],
      },
    ];
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.scripts.length, 1);
    assert.ok(
      result.data?.warnings.some((w) => /unknown creativeId/i.test(w)),
    );
    const beat0 = result.data!.scripts[0]!.beats[0]!;
    assert.deepEqual(beat0.factIds, ["fact_001"]);
    assert.deepEqual(beat0.assetIds, [ASSET_A]);
    assert.deepEqual(beat0.shots[0]!.assetIds, [ASSET_A]);
  });

  it("A selected count is 3; B pool ≤18 skips embed", async () => {
    assert.equal(SELECTED_CREATIVE_COUNT, 3);
    assert.equal(TRIM_EMBED_SKIP_MAX, 18);
    const brief = buildCreativeBrief(baseUnderstanding());
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    assert.ok(creatives.length <= TRIM_EMBED_SKIP_MAX);
    let embedCalls = 0;
    const result = await trimCreative(
      { brief, angles, creatives },
      {
        embedFn: async (texts) => {
          embedCalls += 1;
          return {
            vectors: texts.map(() => [1, 0]),
            model: "mock",
            latencyMs: 1,
            usage: { promptTokens: 0, totalTokens: 0 },
          };
        },
      },
    );
    assert.equal(embedCalls, 0);
    assert.equal(result.metrics.embedFallback, "skipped");
  });

  it("C–E shots required; productRole needs assetIds; known assetIds only", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(0, 1);
    const scripts: Script[] = [
      {
        id: "script_shots",
        creativeId: selected[0]!.id,
        visualDirection: { ...TEST_VD },
        audioDirection: { ...TEST_AD },
        beats: [
          {
            purpose: "tension",
            voiceover: voWords(12, "t"),
            // missing shots → dropped
          } as Script["beats"][number],
          {
            purpose: "bad_product",
            voiceover: voWords(12, "b"),
            shots: [
              {
                intent: "Should fail",
                action: "No asset but hero role",
                assetIds: [],
                productRole: "hero",
                treatment: "generate",
              },
            ],
          },
          {
            purpose: "ok_asset",
            voiceover: voWords(12, "o"),
            shots: [
              testShot([ASSET_A, "asset_bogus"], {
                productRole: "hero",
                treatment: "animate",
              }),
            ],
          },
          {
            purpose: "ok_gen",
            voiceover: voWords(10, "g"),
            shots: [testShot()],
          },
          {
            purpose: "ok_ref",
            voiceover: voWords(10, "r"),
            shots: [
              testShot([ASSET_B], {
                intent: "Ref motion",
                action: "Pouch guides atmosphere",
                productRole: "reference",
                treatment: "generate",
              }),
            ],
          },
        ],
      },
    ];
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          return mockOk({ scripts }, "expandScript");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.scripts.length, 1);
    const beats = result.data!.scripts[0]!.beats;
    assert.equal(beats.length, 3);
    assert.ok(beats.every((b) => b.shots.length >= 1));
    assert.ok(
      !beats.some((b) =>
        b.shots.some(
          (sh) => sh.productRole !== "none" && sh.assetIds.length === 0,
        ),
      ),
    );
    assert.deepEqual(beats[0]!.assetIds, [ASSET_A]);
    assert.ok(result.data?.warnings.some((w) => /missing shots/i.test(w)));
    assert.ok(
      result.data?.warnings.some((w) =>
        /productRole=hero needs known assetIds/i.test(w),
      ),
    );
  });

  it("F–G select/expand registry Pro; expand promptVersion v3.4", async () => {
    const { aiRegistry, EXPAND_SCRIPT_PROMPT_VERSION, VOLC_LOGICAL_PRO } =
      await import("@/lib/ai");
    assert.equal(aiRegistry.selectCreative.model, VOLC_LOGICAL_PRO);
    assert.equal(aiRegistry.selectCreative.reasoningLevel, "high");
    assert.equal(aiRegistry.expandScript.model, VOLC_LOGICAL_PRO);
    assert.equal(aiRegistry.expandScript.reasoningLevel, "medium");
    assert.equal(EXPAND_SCRIPT_PROMPT_VERSION, "creative-expand-v3.4");
    assert.equal(
      aiRegistry.expandScript.promptVersion,
      "creative-expand-v3.4",
    );
  });

  it("makes exactly one AI call for all scripts (no retry path)", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const selected = makeCreatives(makeAngles()).slice(
      0,
      SELECTED_CREATIVE_COUNT,
    );
    let calls = 0;
    const runner = {
      async runCapability(capability) {
        if (capability === "expandScript") {
          calls += 1;
          return mockOk(
            { scripts: validScripts(selected) },
            "expandScript",
          );
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const result = await expandScript({ brief, selected }, { runner });
    assert.equal(result.status, "ok");
    assert.equal(calls, 1);
    assert.equal(result.execution.calls.length, 1);
    assert.equal(result.data?.scripts.length, SELECTED_CREATIVE_COUNT);
  });
});

describe("createCreativeFlow orchestrator", () => {
  it("returns ok CreativeFlowResult with mock runner", async () => {
    const understanding = baseUnderstanding();
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    const selectedIds = creatives
      .filter((_, i) => i % 7 === 0)
      .slice(0, SELECTED_CREATIVE_COUNT)
      .map((c) => c.id);
    // Pick SELECTED_CREATIVE_COUNT distinct creatives from the compact pool
    const trimSafeIds = creatives.slice(0, SELECTED_CREATIVE_COUNT).map((c) => c.id);

    const runner = v2Runner({
      gen: { angles, creatives },
      selectIds: trimSafeIds,
      scripts: validScripts(
        creatives.filter((c) => trimSafeIds.includes(c.id)),
      ),
    });

    const result = await createCreativeFlow(understanding, {
      runner,
      skipSnapshots: true,
      nowIso: "2026-09-28T12:00:00.000Z",
      forceJaccardFallback: true,
    });

    assert.equal(result.status, "ok");
    assert.ok(result.data);
    assert.equal(result.data.angles.length, FIXTURE_ANGLE_COUNT);
    assert.equal(result.data.creatives.length, FIXTURE_ANGLE_COUNT * FIXTURE_PER_ANGLE);
    assert.equal(result.data.selected.length, SELECTED_CREATIVE_COUNT);
    assert.equal(result.data.scripts.length, SELECTED_CREATIVE_COUNT);
    assert.equal(result.provenance.stageVersion, CREATIVE_V2_STAGE_VERSION);
    assert.ok(result.data.metrics);
    assert.equal(result.data.metrics?.generatedCount, FIXTURE_ANGLE_COUNT * FIXTURE_PER_ANGLE);
    assert.equal(result.data.metrics?.selectedCount, SELECTED_CREATIVE_COUNT);
    assert.equal(result.data.metrics?.unsupportedClaimRejectedCount, "unavailable");
    assert.ok(
      result.execution.calls.every(
        (c) => c.promptVersion === CREATIVE_PROMPT_VERSION,
      ),
    );
    assert.ok(result.execution.calls.some((c) => c.capability === "generateCreative"));
    assert.ok(result.execution.calls.some((c) => c.capability === "selectCreative"));
    assert.ok(result.execution.calls.some((c) => c.capability === "expandScript"));
    // Exactly 3 AI chat calls — no post-expand semantic AI
    assert.equal(result.execution.calls.length, 3);
    void selectedIds;
  });

  it("createCreativePlan is thin wrap of createCreativeFlow", async () => {
    const understanding = baseUnderstanding();
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    const trimSafeIds = creatives.slice(0, SELECTED_CREATIVE_COUNT).map((c) => c.id);
    const runner = v2Runner({
      gen: { angles, creatives },
      selectIds: trimSafeIds,
      scripts: validScripts(
        creatives.filter((c) => trimSafeIds.includes(c.id)),
      ),
    });
    const result = await createCreativePlan(understanding, {
      runner,
      skipSnapshots: true,
      forceJaccardFallback: true,
    });
    assert.equal(result.status, "ok");
    assert.ok(result.data?.scripts.length);
  });

  it("AI fail closed — generateCreative error → failed, no invented pool", async () => {
    const runner = {
      async runCapability(capability) {
        if (capability === "generateCreative") {
          throw new Error("provider down");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;

    const result = await createCreativeFlow(baseUnderstanding(), {
      runner,
      skipSnapshots: true,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.data, null);
    assert.ok(
      result.execution.errors.some((e) =>
        /provider down/i.test(e.errorMessage),
      ),
    );
  });

  it("stopAfter=generateCreative skips premium/expand", async () => {
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    let called: string[] = [];
    const runner = {
      async runCapability(capability) {
        called.push(capability);
        if (capability === "generateCreative") {
          return mockOk({ angles, creatives }, "generateCreative");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;

    const result = await createCreativeFlow(baseUnderstanding(), {
      runner,
      skipSnapshots: true,
      stopAfter: "generateCreative",
    });
    assert.equal(result.status, "ok");
    assert.equal(result.data?.creatives.length, FIXTURE_ANGLE_COUNT * FIXTURE_PER_ANGLE);
    assert.equal(result.data?.selected.length, 0);
    assert.equal(result.data?.scripts.length, 0);
    assert.deepEqual(called, ["generateCreative"]);
  });
});

describe("creative V2 constants", () => {
  it("exposes compact ranges and VO bounds via types", () => {
    assert.equal(CREATIVE_ANGLE_MIN, 3);
    assert.equal(CREATIVE_ANGLE_MAX, 6);
    assert.equal(CREATIVE_TOTAL_MIN, 8);
    assert.equal(CREATIVE_TOTAL_MAX, 18);
    assert.equal(SELECTED_CREATIVE_COUNT, 3);
    assert.equal(TRIM_EMBED_SKIP_MAX, 18);
    const brief: CreativeBrief = buildCreativeBrief(baseUnderstanding());
    assert.equal(brief.constraints.language, "en");
  });

  it("flow provenance includes runId + inputHash", async () => {
    const angles = makeAngles();
    const creatives = makeCreatives(angles);
    const trimSafeIds = creatives.slice(0, SELECTED_CREATIVE_COUNT).map((c) => c.id);
    const runner = v2Runner({
      gen: { angles, creatives },
      selectIds: trimSafeIds,
      scripts: validScripts(
        creatives.filter((c) => trimSafeIds.includes(c.id)),
      ),
    });
    const result = await createCreativeFlow(baseUnderstanding(), {
      runner,
      skipSnapshots: true,
      forceJaccardFallback: true,
      runId: "test-run-lineage",
    });
    assert.equal(result.status, "ok");
    assert.equal(result.provenance.runId, "test-run-lineage");
    assert.ok(result.provenance.inputHash.length >= 16);
  });
});
