import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AiRunner, AiUsageRecord, RunCapabilityResult } from "@/lib/ai";
import {
  aiRegistry,
  CREATIVE_PROMPT_VERSION,
  DEFAULT_AI_MODEL,
  DEFAULT_PROMPT_VERSION,
  getCapabilitiesByModel,
  getCapabilitiesByProvider,
  listCapabilities,
} from "@/lib/ai";
import {
  fixedClock,
  normalizeProductStageInput,
} from "@/lib/normalize";
import type { ProductStageInput } from "@/lib/product-stage-input";
import type { StageResult } from "@/lib/workflow/types";
import { buildCacheKey, canonicalJson } from "./cache";
import {
  guardFactsWithSourceText,
  guardInferences,
  MAX_INFERENCES_PER_CATEGORY,
  MAX_TEXT_FACTS,
  truncateFacts,
} from "./guards";
import { buildProductUnderstanding } from "./buildProductUnderstanding";
import { PRODUCT_INTELLIGENCE_STAGE_VERSION } from "./mergeUnderstanding";
import { understandImages } from "./understandImages";
import { understandText } from "./understandText";
import { understandVideos } from "./understandVideos";
import type { FactItem, ProductUnderstanding } from "./types";

const clock = fixedClock("2026-09-26T12:00:00.000Z");
const __dirname = dirname(fileURLToPath(import.meta.url));

function baseInput(
  overrides: Partial<ProductStageInput> = {},
): ProductStageInput {
  const base: ProductStageInput = {
    version: 1,
    jobId: "job_test",
    source: { url: "https://shop.example.com/p", kind: "shopify" },
    product: {
      title: "Lemon Tea",
      description: "A floral oolong with lemon notes. Sugar Free.",
      bullets: ["Sugar Free", "Gluten Free"],
      pricing: { currency: "USD", listPrice: "14.09" },
      audience: "Tea drinkers who skip sugar",
      notes: "Keep voice playful",
    },
    branding: {},
    media: {
      images: [
        {
          id: "img_a",
          url: "https://cdn.example.com/a.jpg",
          fileName: "a.jpg",
        },
      ],
      videos: [],
      primaryImageUrl: "https://cdn.example.com/a.jpg",
    },
      completeness: { readyForNextStage: true, missing: [] },
  };
  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...(overrides.source || {}) },
    product: {
      ...base.product,
      ...(overrides.product || {}),
      pricing: {
        ...base.product.pricing,
        ...(overrides.product?.pricing || {}),
      },
    },
    branding: { ...base.branding, ...(overrides.branding || {}) },
    media: {
      ...base.media,
      ...(overrides.media || {}),
      images: overrides.media?.images ?? base.media.images,
      videos: overrides.media?.videos ?? base.media.videos,
    },
    completeness: {
      ...base.completeness,
      ...(overrides.completeness || {}),
    },
  };
}

function mockOk<T>(data: T, capability: AiUsageRecord["capability"]): RunCapabilityResult<T> {
  return {
    data,
    usage: {
      capability,
      provider: "volcengine",
      model: DEFAULT_AI_MODEL,
      promptVersion: DEFAULT_PROMPT_VERSION,
      status: "ok",
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 5,
      cached: false,
    },
  };
}

function textDraftOk() {
  return {
    product: {
      name: "Lemon Tea",
      brand: null,
      category: "tea",
    },
    facts: [
      {
        id: "fact_001",
        statement: "Product is sugar free",
        type: "attribute",
        source: { kind: "text" as const, field: "text.bullets[0]" },
        sourceText: "Sugar Free",
        confidence: 0.95,
        usableAsAdClaim: true,
      },
    ],
    inferences: {
      possibleAudiences: [
        {
          id: "inf_001",
          statement: "Health-conscious tea drinkers",
          type: "audience" as const,
          basedOnFactIds: ["fact_001"],
          confidence: 0.4,
        },
      ],
      possibleUseCases: [],
      possiblePurchaseMotivations: [],
    },
    warnings: [],
  };
}

function slimImage(assetId: string) {
  return {
    assetId,
    conciseDescription: "Product bag on white",
    possibleAssetRoles: ["packshot", "hero"],
    suitabilityForAd: "strong",
    productView: "front" as const,
    referenceQuality: "strong" as const,
    visualElements: [
      {
        type: "package",
        description: "Front of product pouch",
        usability: "hero",
      },
    ],
  };
}

function assertStageResultShape(
  result: StageResult<ProductUnderstanding>,
): ProductUnderstanding {
  assert.equal(result.status, "ok");
  assert.ok(result.data);
  assert.ok(Array.isArray(result.execution.calls));
  assert.ok(Array.isArray(result.execution.errors));
  assert.equal(
    result.provenance.stageVersion,
    PRODUCT_INTELLIGENCE_STAGE_VERSION,
  );
  assert.ok(result.provenance.generatedAt);
  assert.ok(result.provenance.runId);
  assert.ok(result.provenance.inputHash);

  const out = result.data;
  assert.equal(out.version, 1);
  assert.equal(out.normalizedVersion, 1);
  assert.ok(Array.isArray(out.facts));
  assert.ok(out.userContext);
  assert.equal("claims" in out, false, "claims[] must be deleted");
  assert.equal("evidence" in out, false, "evidence[] must be deleted");
  assert.equal(
    "execution" in out,
    false,
    "execution must live on StageResult, not ProductUnderstanding",
  );
  assert.equal(
    "provenance" in out,
    false,
    "provenance must live on StageResult, not ProductUnderstanding",
  );
  assert.equal(
    "usage" in out,
    false,
    "top-level usage moved to StageResult.execution.calls",
  );
  assert.ok(out.inferences);
  assert.ok(out.assets);
  assert.ok(Array.isArray(out.assets.images));
  assert.ok(Array.isArray(out.assets.videos));
  assert.ok(out.validation.modalityStatus);
  assert.equal(
    "fusion" in out.validation.modalityStatus,
    false,
    "fusion modality must be gone",
  );
  for (const f of out.facts) {
    assert.ok(f.sourceText.trim().length > 0, "fact must have sourceText");
    assert.equal(typeof f.usableAsAdClaim, "boolean");
  }
  for (const img of out.assets.images) {
    assert.equal(
      Object.keys(img).sort().join(","),
      [
        "assetId",
        "conciseDescription",
        "possibleAssetRoles",
        "productView",
        "referenceQuality",
        "suitabilityForAd",
        "visualElements",
      ]
        .sort()
        .join(","),
      "ImageUnderstanding must include grounding fields",
    );
    assert.ok(img.productView);
    assert.ok(img.referenceQuality);
    assert.ok(Array.isArray(img.visualElements));
  }
  return out;
}

describe("guardFactsWithSourceText", () => {
  it("drops facts missing sourceText", () => {
    const facts: FactItem[] = [
      {
        id: "fact_001",
        statement: "Sugar free",
        type: "attribute",
        source: { kind: "text", field: "text.bullets[0]" },
        sourceText: "Sugar Free",
        confidence: 0.9,
        usableAsAdClaim: true,
      },
      {
        id: "fact_002",
        statement: "Invented claim",
        type: "feature",
        source: { kind: "text", field: "text.description" },
        sourceText: "  ",
        confidence: 0.5,
        usableAsAdClaim: false,
      },
    ];
    const { kept, dropped } = guardFactsWithSourceText(facts);
    assert.equal(dropped, 1);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, "fact_001");
    assert.equal(kept[0].usableAsAdClaim, true);
  });
});

describe("guards — max facts / inferences", () => {
  it("truncateFacts caps at MAX_TEXT_FACTS (8)", () => {
    const facts = Array.from({ length: 12 }, (_, i) => ({
      id: `fact_${i}`,
      statement: `Fact ${i}`,
      type: "attribute",
      source: { kind: "text" as const, field: "text.description" },
      sourceText: `src ${i}`,
      confidence: 1,
      usableAsAdClaim: true,
    }));
    assert.equal(truncateFacts(facts).length, MAX_TEXT_FACTS);
  });

  it("guardInferences caps at ≤2 per category", () => {
    const items = [1, 2, 3].map((n) => ({
      id: `inf_${n}`,
      statement: `Audience ${n}`,
      type: "audience" as const,
      basedOnFactIds: ["fact_001"],
      confidence: 0.5,
    }));
    const kept = guardInferences(items);
    assert.equal(kept.length, MAX_INFERENCES_PER_CATEGORY);
    assert.equal(MAX_INFERENCES_PER_CATEGORY, 2);
  });
});

describe("empty media skips API", () => {
  it("videos=[] makes zero AI calls", async () => {
    let calls = 0;
    const runner = {
      runCapability: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    } as AiRunner;
    const product = normalizeProductStageInput(baseInput(), { clock });
    assert.equal(product.media.videos.length, 0);
    const res = await understandVideos(product, { runner, skipCache: true });
    assert.equal(calls, 0);
    assert.equal(res.status, "skipped");
    assert.deepEqual(res.videos, []);
    assert.deepEqual(res.usage, []);
  });

  it("images=[] makes zero AI calls", async () => {
    let calls = 0;
    const runner = {
      runCapability: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    } as AiRunner;
    const product = normalizeProductStageInput(
      baseInput({ media: { images: [], videos: [], primaryImageUrl: undefined } }),
      { clock },
    );
    const res = await understandImages(product, { runner, skipCache: true });
    assert.equal(calls, 0);
    assert.equal(res.status, "skipped");
    assert.deepEqual(res.images, []);
  });

  it("0 image + 0 video → skipped modalities, only text AI call", async () => {
    let calls = 0;
    const runner = {
      async runCapability(capability) {
        calls += 1;
        if (capability === "understandText") {
          return mockOk(textDraftOk(), "understandText");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const product = normalizeProductStageInput(
      baseInput({ media: { images: [], videos: [], primaryImageUrl: undefined } }),
      { clock },
    );
    const result = await buildProductUnderstanding(product, {
      runner,
      skipCache: true,
      nowIso: "2026-09-26T12:00:00.000Z",
    });
    const out = assertStageResultShape(result);
    assert.equal(calls, 1);
    assert.equal(out.validation.modalityStatus.images, "skipped");
    assert.equal(out.validation.modalityStatus.videos, "skipped");
    assert.equal(out.userContext.audience, "Tea drinkers who skip sugar");
    assert.equal(out.userContext.instructions, "Keep voice playful");
  });
});

describe("buildProductUnderstanding with mock runner", () => {
  it("assembles StageResult via deterministic merge (slim schema + parallel)", async () => {
    const product = normalizeProductStageInput(baseInput(), { clock });
    const imageId = product.media.images[0]?.id;
    assert.ok(imageId);

    const callsLog: string[] = [];
    const started: number[] = [];
    const runner = {
      async runCapability(capability, _input) {
        callsLog.push(capability);
        started.push(Date.now());
        if (capability === "understandText") {
          await new Promise((r) => setTimeout(r, 15));
          return mockOk(textDraftOk(), "understandText");
        }
        if (capability === "understandImages") {
          await new Promise((r) => setTimeout(r, 15));
          return mockOk({ images: [slimImage(imageId)] }, "understandImages");
        }
        throw new Error(`unexpected capability ${capability}`);
      },
    } as AiRunner;

    const fakeFetch: typeof fetch = async () =>
      new Response(Buffer.from("fakepng"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });

    const t0 = Date.now();
    const result = await buildProductUnderstanding(product, {
      runner,
      skipCache: true,
      nowIso: "2026-09-26T12:00:00.000Z",
      fetchImpl: fakeFetch,
    });
    const elapsed = Date.now() - t0;

    const out = assertStageResultShape(result);
    assert.equal(result.provenance.generatedAt, "2026-09-26T12:00:00.000Z");
    assert.equal(out.validation.modalityStatus.videos, "skipped");
    assert.equal(out.validation.modalityStatus.text, "ok");
    assert.ok(!callsLog.includes("understandVideo"));
    assert.ok(!callsLog.includes("fuseUnderstanding"));
    assert.ok(!callsLog.includes("generateConcepts"));
    assert.ok(!callsLog.includes("composeCreativePlan"));
    assert.ok(out.validation.readyForCreativeStage);
    assert.equal(out.facts.length, 1);
    assert.equal(out.facts[0]?.usableAsAdClaim, true);
    assert.equal(out.assets.images[0]?.assetId, imageId);
    assert.equal(result.execution.errors.length, 0);
    assert.ok(result.execution.calls.length >= 2);
    // Parallel: both modalities start before either finishes (~15ms each) → wall < 25ms serial
    assert.ok(
      elapsed < 40,
      `expected parallel wall clock, got ${elapsed}ms`,
    );
    assert.equal(out.userContext.audience, "Tea drinkers who skip sugar");
  });

  it("puts quota errors in StageResult.execution; ready=false; fail closed", async () => {
    const product = normalizeProductStageInput(baseInput(), { clock });
    const runner = {
      async runCapability(capability) {
        if (capability === "understandText") {
          return mockOk(textDraftOk(), "understandText");
        }
        if (capability === "understandImages") {
          const err = new Error("429 RESOURCE_EXHAUSTED quota exceeded");
          (err as Error & { aiErrorType: string }).aiErrorType = "quota";
          throw err;
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;

    const fakeFetch: typeof fetch = async () =>
      new Response(Buffer.from("fakepng"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });

    const result = await buildProductUnderstanding(product, {
      runner,
      skipCache: true,
      fetchImpl: fakeFetch,
    });

    const out = assertStageResultShape(result);
    assert.equal(out.validation.modalityStatus.images, "failed");
    assert.equal(out.validation.readyForCreativeStage, false);
    assert.ok(
      out.validation.missingFields.includes("images_ok_for_creative"),
    );
    assert.equal(out.assets.images.length, 0, "no fake image placeholders");
    assert.ok(result.execution.errors.length >= 1);
    assert.equal(result.execution.errors[0]?.capability, "understandImages");
    assert.ok(
      result.execution.errors.some(
        (e) =>
          e.errorType === "quota" ||
          /quota|429/i.test(e.errorMessage),
      ),
    );
  });

  it("modalities run independently — text ok even if images fail", async () => {
    const product = normalizeProductStageInput(baseInput(), { clock });
    const runner = {
      async runCapability(capability) {
        if (capability === "understandText") {
          return mockOk(
            {
              ...textDraftOk(),
              facts: [
                {
                  ...textDraftOk().facts[0],
                  usableAsAdClaim: false,
                },
              ],
            },
            "understandText",
          );
        }
        throw new Error("503 UNAVAILABLE high demand");
      },
    } as AiRunner;
    const fakeFetch: typeof fetch = async () =>
      new Response(Buffer.from("x"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });

    const result = await buildProductUnderstanding(product, {
      runner,
      skipCache: true,
      fetchImpl: fakeFetch,
    });
    const out = assertStageResultShape(result);
    assert.equal(out.validation.modalityStatus.text, "ok");
    assert.equal(out.validation.modalityStatus.images, "failed");
    assert.equal(out.facts.length, 1);
    assert.equal(out.product.name, "Lemon Tea");
  });

  it("understandText uses compact JSON.stringify (no pretty indent)", async () => {
    let contentsSeen = "";
    const runner = {
      async runCapability(capability, input) {
        if (capability === "understandText") {
          contentsSeen =
            typeof input.contents === "string" ? input.contents : "";
          return mockOk(textDraftOk(), "understandText");
        }
        throw new Error(`unexpected ${capability}`);
      },
    } as AiRunner;
    const product = normalizeProductStageInput(
      baseInput({ media: { images: [], videos: [], primaryImageUrl: undefined } }),
      { clock },
    );
    await understandText(product, { runner, skipCache: true });
    assert.ok(contentsSeen.includes("{"));
    assert.ok(
      !/\n\s{2}"/.test(contentsSeen),
      "payload must be compact JSON, not pretty-printed",
    );
  });
});

describe("ai registry forward + reverse (V2 — no legacy creative caps)", () => {
  it("lists understanding + V2 creative capabilities only", () => {
    assert.deepEqual(listCapabilities().sort(), [
      "expandScript",
      "generateCreative",
      "selectCreative",
      "understandImages",
      "understandText",
      "understandVideo",
      "validateAd",
    ]);
    assert.equal("generateConcepts" in aiRegistry, false);
    assert.equal("composeCreativePlan" in aiRegistry, false);
    for (const id of listCapabilities()) {
      const e = aiRegistry[id];
      assert.equal(e.provider, "volcengine");
      if (
        id === "understandText" ||
        id === "understandImages" ||
        id === "understandVideo" ||
        id === "generateCreative"
      ) {
        assert.equal(e.model, "doubao-seed-2.1-lite");
        assert.equal(e.reasoningLevel, "minimal");
      } else if (id === "selectCreative") {
        assert.equal(e.model, "doubao-seed-2.1-pro");
        assert.equal(e.reasoningLevel, "high");
      } else if (id === "expandScript") {
        assert.equal(e.model, "doubao-seed-2.1-pro");
        assert.equal(e.reasoningLevel, "medium");
      } else if (id === "validateAd") {
        assert.equal(e.model, "doubao-seed-2.1-pro");
        assert.equal(e.reasoningLevel, "high");
      }
      const isCreative = [
        "generateCreative",
        "selectCreative",
        "expandScript",
      ].includes(id);
      if (id === "expandScript") {
        assert.equal(e.promptVersion, "creative-expand-v3.4");
      } else if (id === "validateAd") {
        assert.equal(e.promptVersion, "validate-ad-v1");
      } else {
        assert.equal(
          e.promptVersion,
          isCreative ? CREATIVE_PROMPT_VERSION : DEFAULT_PROMPT_VERSION,
        );
        assert.equal(e.promptVersion, isCreative ? "creative-v2" : "v3.1");
      }
    }
  });

  it("getCapabilitiesByProvider / ByModel reverse lookups", () => {
    assert.equal(getCapabilitiesByProvider("volcengine").length, 7);
    assert.equal(getCapabilitiesByProvider("google").length, 0);
    assert.ok(getCapabilitiesByModel("doubao-seed-2.1-lite").length >= 4);
    assert.ok(getCapabilitiesByModel("doubao-seed-2.1-pro").length >= 3);
    assert.deepEqual(getCapabilitiesByModel("nonexistent-model"), []);
  });
});

describe("workflow does not import Gemini SDK", () => {
  it("understanding + build sources have no @google/genai import", () => {
    const files = [
      "buildProductUnderstanding.ts",
      "mergeUnderstanding.ts",
      "understandText.ts",
      "understandImages.ts",
      "understandVideos.ts",
      "index.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), "utf8");
      assert.ok(
        !src.includes("@google/genai"),
        `${f} must not import @google/genai`,
      );
      assert.ok(
        !src.includes("fuseUnderstanding"),
        `${f} must not reference fusion`,
      );
    }
  });
});

describe("cache key stability", () => {
  it("canonicalJson sorts keys", () => {
    assert.equal(
      canonicalJson({ b: 1, a: 2 }),
      canonicalJson({ a: 2, b: 1 }),
    );
    const k1 = buildCacheKey("s", { z: 1, a: 2 });
    const k2 = buildCacheKey("s", { a: 2, z: 1 });
    assert.equal(k1, k2);
  });

  it("uses modality-specific capability for cache key", () => {
    const payload = { assetId: "img_1" };
    const textKey = buildCacheKey("understandText", payload);
    const imageKey = buildCacheKey("understandImages", payload);
    const videoKey = buildCacheKey("understandVideos", payload);
    assert.notEqual(textKey, imageKey);
    assert.notEqual(imageKey, videoKey);
    assert.notEqual(textKey, videoKey);
  });
});

describe("ai model default", () => {
  it("keeps gemini flash constant for deprecated gemini re-exports", () => {
    assert.equal(DEFAULT_AI_MODEL, "gemini-3.8-flash");
  });
});
