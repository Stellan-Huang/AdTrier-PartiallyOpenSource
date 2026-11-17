/**
 * Generation MAP tests H–O — mocked TTS / Seedance / compose (no live media).
 * Continuity v3.4: whole-script TTS, Hero Close, Mini-only, no image cards.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiRunner, RunCapabilityResult } from "@/lib/ai";
import { DEFAULT_AI_MODEL } from "@/lib/ai";
import { buildCreativeBrief } from "@/lib/workflow/creative";
import type { CreativeBrief } from "@/lib/workflow/creative/types";
import type { Script } from "@/lib/workflow/creative/v2/types";
import type { ProductUnderstanding } from "@/lib/understanding";
import { generateSeedreamImage } from "@/lib/ai/providers/volcengine-seedream";
import { clampDurationSec } from "@/lib/ai/providers/volcengine-seedance";
import { compileAdSpec } from "./compileAdSpec";
import {
  buildComposeCaptionCues,
  composeAd,
  planSceneTake,
  subtitleCopyForScene,
  wrapDrawtextLines,
} from "./composeAd";
import {
  generateAd,
  isMediaLevelRegenIssue,
  uniqueMediaRegenIssues,
} from "./generateAd";
import {
  compileSeedancePrompt,
  pickBestReferenceAssetId,
  resolveScene,
} from "./resolveScene";
import { validateAd } from "@/lib/workflow/qa-delivery/validateAd";
import { GENERATION_STAGE_VERSION } from "./types";
import { synthesizeVoice } from "./synthesizeVoice";

const ASSET_A = "img_hero";
const ASSET_B = "img_detail";

const VD = {
  world: "sunlit kitchen",
  palette: "lemon and cream",
  lighting: "soft window light",
  cameraEnergy: "gentle glide",
};
const AD = {
  voiceStyle: "warm conversational",
  musicMood: "soft bright ambient",
};

function baseUnderstanding(): ProductUnderstanding {
  return {
    version: 1,
    jobId: "job_gen_test",
    normalizedVersion: 1,
    product: { name: "Lemon Tea", brand: null, category: "Tea" },
    userContext: { audience: null, instructions: null },
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
    ],
    inferences: {
      possibleAudiences: [],
      possibleUseCases: [],
      possiblePurchaseMotivations: [],
    },
    assets: {
      images: [
        {
          assetId: ASSET_A,
          conciseDescription: "Hero pouch",
          possibleAssetRoles: ["hero"],
          suitabilityForAd: "strong",
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
          conciseDescription: "Detail leaf",
          possibleAssetRoles: ["detail"],
          suitabilityForAd: "usable",
          productView: "detail",
          referenceQuality: "weak",
          visualElements: [
            {
              type: "ingredient",
              description: "Loose leaf detail",
              usability: "element",
            },
          ],
        },
      ],
      videos: [],
    },
    warnings: [],
    validation: {
      readyForCreativeStage: true,
      missingFields: [],
      invalidFields: [],
      modalityStatus: { text: "ok", images: "ok", videos: "skipped" },
    },
  };
}

function sampleScript(creativeId = "c1"): Script {
  return {
    id: "script_01",
    creativeId,
    visualDirection: { ...VD },
    audioDirection: { ...AD },
    beats: [
      {
        purpose: "tension",
        voiceover: "Sugar free tea that still tastes bright and clean every sip",
        shots: [
          {
            intent: "Steam opens the world",
            action: "Steam curls across empty cup",
            assetIds: [],
            productRole: "none",
            treatment: "generate",
            entry: "Fade from black into steam",
            exit: "Steam carries into next beat",
          },
        ],
      },
      {
        purpose: "reveal",
        voiceover: "Steam rises as the pouch shines under soft kitchen light",
        shots: [
          {
            intent: "Steam with pouch reference",
            action: "Steam curls upward beside pouch",
            assetIds: [ASSET_A],
            productRole: "reference",
            treatment: "generate",
            entry: "Match steam continuity",
            exit: "Light settles on pouch",
          },
        ],
      },
      {
        purpose: "payoff",
        voiceover: "Afternoon reset without the sugar crash feeling tonight",
        shots: [
          {
            intent: "Lifestyle smile no package",
            action: "Warm smile toward camera",
            assetIds: [],
            productRole: "none",
            treatment: "generate",
            entry: "Warmth carries from kitchen light",
            exit: "Smile holds into close",
          },
        ],
      },
    ],
  };
}

function mockMediaOpts(brief: CreativeBrief) {
  const assetUrls: Record<string, string> = {
    [ASSET_A]: "https://cdn.example/hero.jpg",
    [ASSET_B]: "https://cdn.example/detail.jpg",
  };
  return {
    skipSnapshots: true,
    assets: { assetUrls },
    tts: {
      // Whole-script synthesizeFn — one call returns full VO duration.
      synthesizeFn: async () => ({
        audioUrl: "https://cdn.example/vo.mp3",
        durationSec: 12.5,
        model: "mock-tts",
        latencyMs: 3,
        transport: "websocket" as const,
      }),
    },
    seedance: {
      generateFn: async (
        _input: { prompt: string },
        tier: "mini" | "pro-fast" | "2.5",
      ) => ({
        videoUrl: `https://cdn.example/seedance-${tier}.mp4`,
        model:
          tier === "mini"
            ? "mock-mini"
            : tier === "pro-fast"
              ? "mock-pro-fast"
              : "mock-25",
        latencyMs: 5,
        tier,
      }),
    },
    compose: {
      composeFn: async () => ({
        composedUrl: "https://cdn.example/ad.mp4",
        latencyMs: 2,
        provider: "mock-ffmpeg",
        model: "mock-concat",
      }),
    },
    sceneMedia: {
      prepareElementFn: async ({ assetId }: { assetId: string }) => ({
        elementUrl: `/tmp/mock-cutout-${assetId}.png`,
        assetId,
        latencyMs: 1,
        provider: "ffmpeg" as const,
        model: "product-cutout-rgba" as const,
      }),
    },
    brief,
  };
}

describe("generation MAP H–O (continuity v3.4)", () => {
  it("H compileAdSpec proportions + guaranteed Hero Close", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { adSpec, warnings } = compileAdSpec(script, 15, { brief });
    // 3 cinematic + 1 Hero Close
    assert.equal(adSpec.scenes.length, 4);
    assert.equal(adSpec.scenes[0]!.start, 0);
    assert.ok(adSpec.scenes[3]!.end >= 14.9);
    assert.equal(adSpec.scenes[3]!.isHeroClose, true);
    assert.equal(adSpec.scenes[3]!.productRole, "hero");
    assert.equal(adSpec.scenes[3]!.treatment, "composite");
    assert.deepEqual(adSpec.scenes[3]!.assetIds, [ASSET_A]);
    assert.equal(adSpec.scenes[0]!.entry, "Fade from black into steam");
    assert.equal(adSpec.visualDirection?.world, VD.world);
    assert.equal(adSpec.audioDirection?.musicMood, AD.musicMood);
    // Short beats may merge — warnings ok
    assert.ok(Array.isArray(warnings));
  });

  it("H3 short VO anchors to 15s with Hero absorbing remainder", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { adSpec } = compileAdSpec(script, 10.68, { brief });
    const hero = adSpec.scenes.find((s) => s.isHeroClose)!;
    assert.ok(hero.end >= 14.9);
    assert.ok(hero.end - hero.start >= 4);
    assert.ok(hero.start <= 10.68);
    for (const s of adSpec.scenes.filter((x) => !x.isHeroClose)) {
      assert.ok(
        s.end - s.start >= 3.0 - 0.05,
        `shot ${s.id} too short: ${s.end - s.start}`,
      );
    }
  });

  it("H4 pickBestReference prefers hero/front over callout detail", () => {
    const understanding = baseUnderstanding();
    understanding.assets.images = [
      {
        assetId: "img_2_callout",
        conciseDescription: "Ingredient callout",
        possibleAssetRoles: ["ingredient", "detail"],
        suitabilityForAd: "strong",
        productView: "detail",
        referenceQuality: "strong",
        visualElements: [
          {
            type: "text",
            description: "Four labeled callout lines on bowl",
            usability: "element",
          },
        ],
      },
      {
        assetId: "img_4_pouch",
        conciseDescription: "Hero pouch",
        possibleAssetRoles: ["hero", "packshot"],
        suitabilityForAd: "strong",
        productView: "front",
        referenceQuality: "strong",
        visualElements: [
          {
            type: "package",
            description: "Front pouch",
            usability: "hero",
          },
        ],
      },
    ];
    const brief = buildCreativeBrief(understanding);
    assert.equal(
      pickBestReferenceAssetId(brief, undefined, { forRole: "hero" }),
      "img_4_pouch",
    );
  });

  it("H2 whole-script TTS is one call (not N beat calls)", async () => {
    let calls = 0;
    const script = sampleScript();
    const voice = await synthesizeVoice(script, {
      synthesizeFn: async (text) => {
        calls += 1;
        assert.ok(text.includes("Sugar free"));
        assert.ok(text.includes("Afternoon reset"));
        return {
          audioUrl: "https://cdn.example/vo.mp3",
          durationSec: 14.2,
          model: "mock-tts",
          latencyMs: 1,
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(voice.mode, "whole-script");
    assert.equal(voice.beats.length, 3);
    assert.ok(voice.beats.every((b) => b.audioUrl === voice.audioUrl));
  });

  it("I code routing: always Mini + Hero Close reference_image", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { adSpec } = compileAdSpec(script, 15, { brief });
    const hero = adSpec.scenes.find((s) => s.isHeroClose)!;
    const plan = resolveScene(hero, brief, {
      assetUrls: { [ASSET_A]: "https://x/a.jpg" },
      visualDirection: script.visualDirection,
    });
    assert.equal(plan.mode, "seedance");
    assert.equal(plan.tier, "mini");
    assert.equal(plan.isHeroClose, true);
    assert.equal(plan.referenceImageUrl, "https://x/a.jpg");
    assert.equal(plan.referenceRole, "reference_image");
    assert.equal(plan.requireElement, false);
    assert.equal(plan.prepareElementAssetId, undefined);
    assert.deepEqual(plan.prepareElementCandidateIds ?? [], []);
    assert.ok(/exact pouch from the reference/i.test(plan.prompt));
    assert.ok(!/do not invent/i.test(plan.prompt));
    assert.equal(pickBestReferenceAssetId(brief, undefined, { forRole: "hero" }), ASSET_A);
  });

  it("I2 preview uses SEEDANCE_PREVIEW_TIER; production stays Mini", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const sensory: import("./types").SceneSpec = {
      id: "scene_sensory",
      start: 0,
      end: 4,
      beatIndex: 0,
      shotIndex: 0,
      intent: "petals swirl",
      action: "Petals drift across frame",
      treatment: "generate",
      productRole: "none",
      assetIds: [],
    };
    const invite: import("./types").SceneSpec = {
      id: "scene_invite",
      start: 4,
      end: 8,
      beatIndex: 1,
      shotIndex: 0,
      intent: "pouch by cup",
      action: "Pouch settles beside steaming cup",
      treatment: "generate",
      productRole: "hero",
      assetIds: [ASSET_A],
    };
    const prevTier = process.env.SEEDANCE_PREVIEW_TIER;
    process.env.SEEDANCE_PREVIEW_TIER = "pro-fast";
    try {
      const previewSensory = resolveScene(sensory, brief, {
        generationQuality: "preview",
        assetUrls: { [ASSET_A]: "https://x/a.jpg" },
      });
      assert.equal(previewSensory.tier, "pro-fast");

      const previewInvite = resolveScene(invite, brief, {
        generationQuality: "preview",
        assetUrls: { [ASSET_A]: "https://x/a.jpg" },
      });
      assert.equal(previewInvite.tier, "pro-fast");
      assert.equal(previewInvite.referenceAssetId, ASSET_A);
      assert.equal(previewInvite.referenceRole, "first_frame");

      const prodInvite = resolveScene(invite, brief, {
        generationQuality: "production",
        assetUrls: { [ASSET_A]: "https://x/a.jpg" },
      });
      assert.equal(prodInvite.tier, "mini");
      assert.equal(prodInvite.referenceRole, "reference_image");
    } finally {
      if (prevTier === undefined) delete process.env.SEEDANCE_PREVIEW_TIER;
      else process.env.SEEDANCE_PREVIEW_TIER = prevTier;
    }
  });

  it("I3 prompt compiler uses VisualDirection + entry/exit", () => {
    const scene: import("./types").SceneSpec = {
      id: "s1",
      start: 0,
      end: 3,
      beatIndex: 0,
      shotIndex: 0,
      intent: "Steam open",
      action: "Steam rises",
      treatment: "generate",
      productRole: "none",
      assetIds: [],
      entry: "From black",
      exit: "Into cup",
    };
    const prompt = compileSeedancePrompt(scene, VD);
    assert.ok(prompt.includes(VD.world));
    assert.ok(prompt.includes("From black"));
    assert.ok(prompt.includes("Into cup"));
    assert.ok(!/8K|cinematic masterpiece/i.test(prompt));
  });

  it("J generateAd happy path with mocked media", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const media = mockMediaOpts(brief);
    let ttsCalls = 0;
    const result = await generateAd(script, brief, {
      ...media,
      tts: {
        synthesizeFn: async () => {
          ttsCalls += 1;
          return {
            audioUrl: "https://cdn.example/vo.mp3",
            durationSec: 12.5,
            model: "mock-tts",
            latencyMs: 3,
          };
        },
      },
    });
    assert.equal(result.status, "ok");
    assert.ok(result.data?.composedUrl);
    assert.equal(result.data?.scenes.length, 4);
    assert.ok(result.data?.adSpec.scenes.some((s) => s.isHeroClose));
    assert.equal(ttsCalls, 1);
    assert.ok(
      result.execution.calls.some(
        (c) =>
          c.capability === "synthesizeVoice" &&
          c.promptVersion === "tts-script-v1",
      ),
    );
    assert.equal(result.provenance.stageVersion, GENERATION_STAGE_VERSION);
    assert.equal(result.provenance.stageVersion, "generation@3");
    assert.ok(result.data?.beatVoiceovers?.length === 3);
  });

  it("K composeAd without ffmpeg and without mock fails closed", async () => {
    await assert.rejects(
      () =>
        composeAd({
          adSpec: {
            id: "ad_x",
            creativeId: "c1",
            scenes: [],
          },
          scenes: [
            {
              sceneId: "scene_01",
              treatment: "generate",
              mediaUrl: "https://x/v.mp4",
              provider: "x",
              model: "x",
              latencyMs: 1,
              retries: 0,
              fallbackUsed: false,
            },
          ],
          voiceoverUrl: "https://x/vo.mp3",
        }),
      /ffmpeg not available|ffmpeg (compose|normalize|concat|mux) failed|composeAd (requires|download failed)|fetch failed|ENOTFOUND|ECONNREFUSED/i,
    );
  });

  it("L Seedream stub unused on MAP path", async () => {
    await assert.rejects(
      () => generateSeedreamImage({ prompt: "x" }),
      /stubbed unused on MAP path/i,
    );
    const brief = buildCreativeBrief(baseUnderstanding());
    const result = await generateAd(sampleScript(), brief, mockMediaOpts(brief));
    assert.equal(result.status, "ok");
    assert.ok(
      !result.execution.calls.some((c) => /seedream/i.test(c.capability)),
    );
    assert.ok(
      result.data?.scenes.every((s) => /mini|mock-mini/i.test(s.model)),
    );
  });

  it("M validateAd deterministic timing + missing media", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { adSpec } = compileAdSpec(script, 15, { brief });
    const ad = {
      id: adSpec.id,
      creativeId: script.creativeId,
      scriptId: script.id,
      adSpec,
      voiceoverUrl: "https://cdn.example/vo.mp3",
      voiceoverDurationSec: 15,
      scenes: adSpec.scenes.slice(0, 2).map((s) => ({
        sceneId: s.id,
        treatment: s.treatment,
        mediaUrl: "https://cdn.example/s.mp4",
        provider: "mock",
        model: "m",
        latencyMs: 1,
        retries: 0,
        fallbackUsed: false,
      })),
      composedUrl: "https://cdn.example/ad.mp4",
      manifest: {
        version: 1 as const,
        scriptId: script.id,
        voiceoverDurationSec: 15,
        composed: true,
        calls: [],
      },
    };
    const { result } = await validateAd(ad, script, brief, adSpec, {
      skipAi: true,
    });
    assert.equal(result.pass, false);
    assert.ok(result.issues.some((i) => /Scene count mismatch/i.test(i.reason)));
  });

  it("N hard fail → Mini retry once → fail closed without static asset", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    let seedanceCalls = 0;
    const result = await generateAd(script, brief, {
      ...mockMediaOpts(brief),
      validate: true,
      runner: {
        async runCapability(capability) {
          if (capability === "validateAd") {
            return {
              data: {
                pass: false,
                issues: [
                  {
                    sceneId: "scene_02",
                    severity: "hard",
                    reason: "Product not visible",
                    action: "regenerate",
                  },
                ],
              },
              usage: {
                capability: "validateAd",
                provider: "volcengine",
                model: DEFAULT_AI_MODEL,
                promptVersion: "validate-ad-v1",
                status: "ok",
                latencyMs: 1,
                cached: false,
              },
            } as RunCapabilityResult<{
              pass: boolean;
              issues: Array<{
                sceneId: string;
                severity: "hard";
                reason: string;
                action: "regenerate";
              }>;
            }>;
          }
          throw new Error(`unexpected ${capability}`);
        },
      } as AiRunner,
      seedance: {
        generateFn: async (_input, tier) => {
          seedanceCalls += 1;
          // 4 initial scenes (incl Hero Close); QA regenerate of scene_02 throws.
          if (seedanceCalls > 4) {
            throw new Error("mini retry failed");
          }
          return {
            videoUrl: `https://cdn.example/seedance-${tier}-${seedanceCalls}.mp4`,
            model: "mock-mini",
            latencyMs: 2,
            tier,
          };
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.data, null);
    assert.ok(
      result.execution.errors.some((e) =>
        /hard fail after Mini retry|fail closed \(no static asset fallback\)/i.test(
          e.errorMessage,
        ),
      ),
    );
    assert.ok(
      !result.execution.calls.some(
        (c) =>
          c.model === "fallback_asset" ||
          c.provider === "layout" ||
          /fallback_asset/i.test(c.errorMessage ?? ""),
      ),
    );
    assert.ok(seedanceCalls >= 5);
  });

  it("O fail closed when Seedance throws (no layout / fallback_asset path)", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const result = await generateAd(script, brief, {
      ...mockMediaOpts(brief),
      validate: true,
      runner: {
        async runCapability(capability) {
          if (capability === "validateAd") {
            return {
              data: { pass: true, issues: [] },
              usage: {
                capability: "validateAd",
                provider: "volcengine",
                model: DEFAULT_AI_MODEL,
                promptVersion: "validate-ad-v1",
                status: "ok",
                latencyMs: 1,
                cached: false,
              },
            } as RunCapabilityResult<{ pass: boolean; issues: [] }>;
          }
          throw new Error(`unexpected ${capability}`);
        },
      } as AiRunner,
      seedance: {
        generateFn: async () => {
          throw new Error("seedance down");
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.data, null);
    assert.ok(
      result.execution.errors.some((e) => /seedance down/i.test(e.errorMessage)),
    );
  });

  it("O2 fail closed when hard QA persists after Mini retry", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    let genCalls = 0;
    const hardClosed = await generateAd(script, brief, {
      ...mockMediaOpts(brief),
      validate: true,
      seedance: {
        generateFn: async (_i, tier) => {
          genCalls += 1;
          if (genCalls > 4) throw new Error("retry failed");
          return {
            videoUrl: `https://cdn.example/ok-${genCalls}.mp4`,
            model: "mock-mini",
            latencyMs: 1,
            tier,
          };
        },
      },
      runner: {
        async runCapability(capability) {
          if (capability === "validateAd") {
            return {
              data: {
                pass: false,
                issues: [
                  {
                    sceneId: "scene_02",
                    severity: "hard",
                    reason: "Need regen",
                    action: "regenerate",
                  },
                ],
              },
              usage: {
                capability: "validateAd",
                provider: "volcengine",
                model: DEFAULT_AI_MODEL,
                promptVersion: "validate-ad-v1",
                status: "ok",
                latencyMs: 1,
                cached: false,
              },
            } as RunCapabilityResult<{
              pass: boolean;
              issues: Array<{
                sceneId: string;
                severity: "hard";
                reason: string;
                action: "regenerate";
              }>;
            }>;
          }
          throw new Error(`unexpected ${capability}`);
        },
      } as AiRunner,
    });

    assert.equal(hardClosed.status, "failed");
    assert.ok(
      hardClosed.execution.errors.some((e) =>
        /hard fail after Mini retry|fail closed \(no static asset fallback\)/i.test(
          e.errorMessage,
        ),
      ),
    );
  });

  it("P0 clampDurationSec uses ceil (5.16 → 6)", () => {
    assert.equal(clampDurationSec(5.16), 6);
    assert.equal(clampDurationSec(4), 4);
    assert.equal(clampDurationSec(3.1), 4);
  });

  it("P0 wrapDrawtextLines preserves apostrophe and wraps long lines", () => {
    assert.equal(wrapDrawtextLines("It's tea"), "It's tea");
    const wrapped = wrapDrawtextLines("Ice enhances lemon custard flavor");
    assert.ok(wrapped.includes("\n"));
    assert.ok(wrapped.includes("flavor"));
    assert.ok(!wrapped.endsWith(" f"));
  });

  it("P0 compose-level duration issue does not count as media regen", () => {
    assert.equal(
      isMediaLevelRegenIssue({
        severity: "hard",
        action: "regenerate",
        sceneId: "scene_05",
        reason: "Composed duration 10.51s outside hard 14–17s band",
      }),
      false,
    );
    assert.equal(
      isMediaLevelRegenIssue({
        severity: "hard",
        action: "regenerate",
        reason: "Composed duration 10.51s outside hard 14–17s band",
      }),
      false,
    );
    assert.equal(
      isMediaLevelRegenIssue({
        severity: "hard",
        action: "regenerate",
        sceneId: "scene_03",
        reason: "Missing scene media",
      }),
      true,
    );
    assert.equal(
      isMediaLevelRegenIssue({
        severity: "hard",
        action: "regenerate",
        sceneId: "scene_05",
        reason: "no product visible in hero close",
      }),
      true,
    );
    assert.equal(
      isMediaLevelRegenIssue({
        severity: "hard",
        action: "regenerate",
        sceneId: "scene_05",
        reason: "Duration is 18s instead of the requested 15s",
      }),
      false,
    );
    const deduped = uniqueMediaRegenIssues([
      {
        severity: "hard",
        action: "regenerate",
        sceneId: "scene_05",
        reason: "Hero Close frame does not show the real product package",
      },
      {
        severity: "hard",
        action: "regenerate",
        sceneId: "scene_05",
        reason: "no product visible in hero close",
      },
    ]);
    assert.equal(deduped.length, 1);
  });

  it("P0 short VO warns Hero Close > 3.6s", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { warnings } = compileAdSpec(script, 10.68, { brief });
    assert.ok(warnings.some((w) => /VO short for 15s/i.test(w)));
  });

  it("fix3 Hero floor 2.5s + VO 12.5 → total 15", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { adSpec } = compileAdSpec(script, 12.5, { brief });
    const hero = adSpec.scenes.find((s) => s.isHeroClose)!;
    assert.ok(hero.end - hero.start >= 2.5 - 1e-6);
    assert.ok(hero.end >= 14.9 && hero.end <= 15.1);
  });

  it("fix3 VO 18.86 hard-fails compile (outside 14–17)", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    assert.throws(() => compileAdSpec(script, 18.86, { brief }), /hard VO budget|outside hard/i);
  });

  it("fix3 planSceneTake drops Mini tail and heroes from tail", () => {
    const nonHero = planSceneTake(4.26, 4.26, { isHeroClose: false });
    assert.ok(nonHero.takeDur <= 4.26 - 0.6 + 1e-6);
    assert.ok(nonHero.savedSec >= 0.59);
    const hero = planSceneTake(2.5, 5.0, {
      isHeroClose: true,
      heroWindow: "tail",
      heroExtraSec: 0.6,
    });
    assert.equal(hero.takeDur, 3.1);
    assert.ok(Math.abs(hero.ss - (5.0 - 3.1)) < 1e-6);
    assert.equal(hero.freezePadSec, 0);
  });

  it("fix4 Hero long scene caps motion at 4s + freeze pad", () => {
    // fix3 failure mode: Hero 5.57s / Mini 6s → ss≈0.43 (cup open still in cut)
    const hero = planSceneTake(5.57, 6.0, {
      isHeroClose: true,
      heroWindow: "tail",
    });
    assert.equal(hero.takeDur, 4);
    assert.ok(Math.abs(hero.ss - 2.0) < 1e-6);
    assert.ok(Math.abs(hero.freezePadSec - 1.57) < 1e-6);
  });

  it("fix4 reference role excludes callout img_2", () => {
    const understanding = baseUnderstanding();
    understanding.assets.images = [
      {
        assetId: "img_2",
        conciseDescription: "Ingredient callout",
        possibleAssetRoles: ["ingredient", "detail"],
        suitabilityForAd: "strong",
        productView: "detail",
        referenceQuality: "strong",
        visualElements: [
          {
            type: "text",
            description: "Four labeled callout lines on bowl",
            usability: "element",
          },
        ],
      },
      {
        assetId: "img_0",
        conciseDescription: "Lifestyle table",
        possibleAssetRoles: ["lifestyle", "packshot"],
        suitabilityForAd: "strong",
        productView: "side",
        referenceQuality: "usable",
        visualElements: [
          { type: "package", description: "Pouch on table", usability: "hero" },
        ],
      },
      {
        assetId: "img_3",
        conciseDescription: "Pour shot",
        possibleAssetRoles: ["lifestyle"],
        suitabilityForAd: "usable",
        productView: "in_use",
        referenceQuality: "usable",
        visualElements: [
          { type: "package", description: "Pouch near cup", usability: "reference" },
        ],
      },
      {
        assetId: "img_4",
        conciseDescription: "Hero pouch",
        possibleAssetRoles: ["hero", "packshot"],
        suitabilityForAd: "strong",
        productView: "front",
        referenceQuality: "strong",
        visualElements: [
          { type: "package", description: "Front pouch", usability: "hero" },
        ],
      },
    ];
    const brief = buildCreativeBrief(understanding);
    const picked = pickBestReferenceAssetId(brief, ["img_2"], {
      forRole: "reference",
    });
    assert.ok(picked === "img_0" || picked === "img_3" || picked === "img_4");
    assert.notEqual(picked, "img_2");
    const scene: import("./types").SceneSpec = {
      id: "scene_03",
      start: 4,
      end: 8,
      beatIndex: 1,
      shotIndex: 0,
      intent: "product in hand",
      action: "Hand lifts pouch",
      treatment: "composite",
      productRole: "reference",
      assetIds: ["img_2"],
    };
    const plan = resolveScene(scene, brief, {
      assetUrls: {
        img_0: "https://x/0.jpg",
        img_2: "https://x/2.jpg",
        img_3: "https://x/3.jpg",
        img_4: "https://x/4.jpg",
      },
    });
    assert.ok(
      plan.referenceAssetId === "img_0" ||
        plan.referenceAssetId === "img_3" ||
        plan.referenceAssetId === "img_4",
    );
    assert.notEqual(plan.referenceAssetId, "img_2");
  });

  it("fix4 4-beat short cinematic budget auto-merges to ≤3 narrative", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    // Clone payoff beat to force 4 narrative beats under short VO budget.
    script.beats.push({
      purpose: "invitation",
      voiceover: "Try the bright pour tonight",
      shots: [
        {
          intent: "Invite sip",
          action: "Cup lifts toward camera",
          assetIds: [ASSET_A],
          productRole: "reference",
          treatment: "animate",
        },
      ],
    });
    const { adSpec, warnings } = compileAdSpec(script, 10.0, { brief });
    const narrative = adSpec.scenes.filter((s) => !s.isHeroClose);
    assert.ok(narrative.length <= 3, `got ${narrative.length} narrative`);
    assert.ok(narrative.length >= 2);
    for (const s of narrative) {
      assert.ok(s.end - s.start >= 3.0 - 0.05, `${s.id}=${s.end - s.start}`);
    }
    assert.ok(
      warnings.some((w) => /Auto-merged|Merged short/i.test(w)) ||
        narrative.length <= 3,
    );
  });

  it("fix4 product prompt forbids double pouch", () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const { adSpec } = compileAdSpec(script, 12.5, { brief });
    const product = adSpec.scenes.find(
      (s) => !s.isHeroClose && s.productRole !== "none",
    )!;
    const prompt = compileSeedancePrompt(product, script.visualDirection);
    assert.ok(/exactly one pouch/i.test(prompt));
    assert.ok(/ONE continuous shot/i.test(prompt));
    const hero = adSpec.scenes.find((s) => s.isHeroClose)!;
    const heroPrompt = compileSeedancePrompt(hero, script.visualDirection);
    assert.ok(/from the first frame/i.test(heroPrompt));
    assert.ok(/exactly one pouch/i.test(heroPrompt));
  });

  it("end-card Hero captions use Brand + product name only (no facts/VO)", () => {
    const cues = buildComposeCaptionCues(
      {
        id: "ad_x",
        creativeId: "c1",
        scenes: [
          {
            id: "scene_01",
            start: 0,
            end: 5,
            beatIndex: 0,
            shotIndex: 0,
            intent: "hook",
            action: "face",
            treatment: "generate",
            productRole: "none",
            assetIds: [],
            voiceover: "Hook voiceover line here",
          },
          {
            id: "scene_hero",
            start: 12.5,
            end: 15,
            beatIndex: 2,
            shotIndex: 99,
            intent: "Hero Close brand lockup",
            action: "product hold",
            treatment: "composite",
            productRole: "hero",
            assetIds: [ASSET_A],
            isHeroClose: true,
            voiceover: "Instant hydration with no tacky residue",
            text: "This is a second-generation hyaluronic acid serum formulated",
          },
        ],
      },
      {
        brand: "The Ordinary",
        claim: "Hyaluronic Acid 2% + B5 (with Ceramides)",
      },
    );
    const hero = cues.filter((c) => c.style === "brand" || c.style === "claim");
    assert.equal(hero.length, 2);
    assert.equal(hero[0]!.style, "brand");
    assert.equal(hero[0]!.text, "The Ordinary");
    // Shortly after Hero Close starts (0.3s), through end of hold.
    assert.ok(
      Math.abs(hero[0]!.startSec - 12.8) < 1e-6,
      `brand start ${hero[0]!.startSec}`,
    );
    assert.equal(hero[0]!.endSec, 15);
    assert.equal(hero[1]!.style, "claim");
    assert.equal(hero[1]!.text, "Hyaluronic Acid 2% + B5 (with Ceramides)");
    assert.equal(hero[1]!.startSec, hero[0]!.startSec);
    assert.equal(hero[1]!.endSec, 15);
    assert.ok(!hero.some((c) => /second-generation|Instant hydration/i.test(c.text)));
    assert.ok(cues.some((c) => c.text === "Hook voiceover line here"));
  });

  it("fix4 subtitles fall back to voiceover when beat.text missing", () => {
    assert.equal(
      subtitleCopyForScene({
        id: "scene_01",
        start: 0,
        end: 3,
        beatIndex: 0,
        shotIndex: 0,
        intent: "x",
        action: "y",
        treatment: "generate",
        productRole: "none",
        assetIds: [],
        voiceover: "Sugar free tea that still tastes bright",
      }),
      "Sugar free tea that still tastes bright",
    );
    assert.equal(
      subtitleCopyForScene({
        id: "scene_01",
        start: 0,
        end: 3,
        beatIndex: 0,
        shotIndex: 0,
        intent: "x",
        action: "y",
        treatment: "generate",
        productRole: "none",
        assetIds: [],
        text: "Sugar free",
        voiceover: "longer spoken line",
      }),
      "Sugar free",
    );
    assert.ok(wrapDrawtextLines("Naturally sweet over ice").length > 0);
  });

  it("fix5 VO subtitle soft-trims to ≤8 words; wrap ≤2 lines", () => {
    const longVo =
      "This smells like lemon custard, cool and creamy on the tongue with extra words";
    const sub = subtitleCopyForScene({
      id: "scene_01",
      start: 0,
      end: 3,
      beatIndex: 0,
      shotIndex: 0,
      intent: "x",
      action: "y",
      treatment: "generate",
      productRole: "none",
      assetIds: [],
      voiceover: longVo,
    });
    assert.equal(sub.split(/\s+/).length, 8);
    const wrapped = wrapDrawtextLines(
      "Ice brings out its naturally sweet lemon flavor with no sugar added today",
    );
    assert.ok(wrapped.split("\n").length <= 2);
  });

  it("fix5 Seedance submit-storm POSTs all before any poll", async () => {
    const { generateScenesSeedanceBatch } = await import(
      "./generateSceneMedia"
    );
    const events: string[] = [];
    const jobs = [1, 2, 3, 4].map((n) => ({
      tier: "mini" as const,
      scene: {
        id: `scene_0${n}`,
        start: 0,
        end: 3,
        beatIndex: 0,
        shotIndex: 0,
        intent: "x",
        action: "y",
        treatment: "generate" as const,
        productRole: "none" as const,
        assetIds: [],
      },
      seedanceInput: {
        prompt: `p${n}`,
        durationSec: 4,
      },
    }));
    const batch = await generateScenesSeedanceBatch(jobs, {
      submitFn: async (_input, tier) => {
        events.push(`submit:${_input.prompt}`);
        await new Promise((r) => setTimeout(r, 30));
        return {
          kind: "pending" as const,
          taskId: `task-${_input.prompt}`,
          model: "mock",
          tier,
          apiKey: "x",
          started: Date.now(),
          durationSec: 4,
          timeoutMs: 60_000,
          pollIntervalMs: 10,
        };
      },
      awaitFn: async (handle) => {
        events.push(`await:${handle.taskId}`);
        await new Promise((r) => setTimeout(r, 20));
        return {
          videoUrl: `https://cdn.example/${handle.taskId}.mp4`,
          model: "mock",
          latencyMs: 50,
          tier: handle.tier,
          taskId: handle.taskId,
        };
      },
    });
    assert.equal(batch.media.length, 4);
    assert.equal(batch.taskIds.length, 4);
    const firstAwait = events.findIndex((e) => e.startsWith("await:"));
    const submits = events.filter((e) => e.startsWith("submit:"));
    assert.equal(submits.length, 4);
    // All 4 submits appear before the first await (submit storm).
    assert.ok(firstAwait >= 4, `events=${events.join(",")}`);
    assert.ok(
      batch.sceneWallMs < 200,
      `expected parallel wall, got ${batch.sceneWallMs}ms`,
    );
  });

  it("fix5 generateAd records timing parallelRatio + task ids", async () => {
    const brief = buildCreativeBrief(baseUnderstanding());
    const script = sampleScript();
    const media = mockMediaOpts(brief);
    const result = await generateAd(script, brief, {
      ...media,
      seedance: {
        submitFn: async (input, tier) => ({
          kind: "ready" as const,
          videoUrl: "https://cdn.example/v.mp4",
          model: "mock-mini",
          latencyMs: 40,
          tier,
          taskId: `tid-${input.prompt.slice(0, 8)}`,
        }),
      },
    });
    assert.equal(result.status, "ok");
    const timing = result.data?.manifest.timing;
    assert.ok(timing);
    assert.ok(timing!.seedanceTaskIds.length >= 1);
    assert.ok(timing!.wallVsSum > 0);
    assert.ok(timing!.parallelEfficiency > 0);
    assert.ok(timing!.sceneLatencySumMs >= timing!.sceneLatencyMaxMs);
  });
});
