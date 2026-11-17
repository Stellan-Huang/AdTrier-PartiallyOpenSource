import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  aiRegistry,
  buildVolcChatBody,
  buildVolcResponseFormat,
  classifyVolcError,
  CREATIVE_PROMPT_VERSION,
  DEFAULT_PROMPT_VERSION,
  getArkApiKeyForCapability,
  getArkLiteModelId,
  getArkProModelId,
  getCapability,
  listCapabilities,
  resolveModel,
  resolveVolcModelId,
  toArkMessages,
  toArkThinkingParams,
  VOLC_DISCOVERED_LITE_ID,
  VOLC_DISCOVERED_PRO_ID,
  VOLC_LOGICAL_LITE,
  VOLC_LOGICAL_PRO,
  getReasoningLevel,
  makeOverrideRunner,
  runCapability,
} from "@/lib/ai";
import {
  STOP_AFTER_ALIASES,
  isDebugPipelineStepId,
  stepsFrom,
  stepsThrough,
} from "@/lib/workflow/step-graph";

describe("volcengine registry + model resolution", () => {
  const prevLite = process.env.ARK_MODEL_LITE;
  const prevPro = process.env.ARK_MODEL_PRO;
  const prevGemini = process.env.GEMINI_MODEL;
  const prevCap = process.env.AI_understandText;
  const prevArk = process.env.ARK_API_KEY;
  const prevSeedLite = process.env.SEED_2_1_LITE_API;
  const prevSeedPro = process.env.SEED_2_1_PRO_API;

  afterEach(() => {
    if (prevLite === undefined) delete process.env.ARK_MODEL_LITE;
    else process.env.ARK_MODEL_LITE = prevLite;
    if (prevPro === undefined) delete process.env.ARK_MODEL_PRO;
    else process.env.ARK_MODEL_PRO = prevPro;
    if (prevGemini === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prevGemini;
    if (prevCap === undefined) delete process.env.AI_understandText;
    else process.env.AI_understandText = prevCap;
    if (prevArk === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = prevArk;
    if (prevSeedLite === undefined) delete process.env.SEED_2_1_LITE_API;
    else process.env.SEED_2_1_LITE_API = prevSeedLite;
    if (prevSeedPro === undefined) delete process.env.SEED_2_1_PRO_API;
    else process.env.SEED_2_1_PRO_API = prevSeedPro;
  });

  it("maps V2 capabilities — no generateConcepts/composeCreativePlan", () => {
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

    assert.equal(aiRegistry.understandText.model, VOLC_LOGICAL_LITE);
    assert.equal(aiRegistry.understandText.reasoningLevel, "minimal");
    assert.equal(aiRegistry.understandText.promptVersion, DEFAULT_PROMPT_VERSION);
    assert.equal(aiRegistry.understandImages.reasoningLevel, "minimal");
    assert.equal(aiRegistry.understandVideo.model, VOLC_LOGICAL_LITE);
    assert.equal(aiRegistry.understandVideo.reasoningLevel, "minimal");
    assert.equal(aiRegistry.generateCreative.reasoningLevel, "minimal");
    assert.equal(aiRegistry.selectCreative.model, VOLC_LOGICAL_PRO);
    assert.equal(aiRegistry.selectCreative.reasoningLevel, "high");
    assert.equal(aiRegistry.expandScript.model, VOLC_LOGICAL_PRO);
    assert.equal(aiRegistry.expandScript.reasoningLevel, "medium");
    assert.equal(aiRegistry.validateAd.model, VOLC_LOGICAL_PRO);
    assert.equal(aiRegistry.validateAd.reasoningLevel, "high");
    assert.equal(aiRegistry.generateCreative.promptVersion, CREATIVE_PROMPT_VERSION);
    assert.equal(aiRegistry.selectCreative.promptVersion, "creative-v2");
    assert.equal(aiRegistry.expandScript.promptVersion, "creative-expand-v3.4");
    assert.equal(aiRegistry.understandText.provider, "volcengine");
  });

  it("EXPAND_SCRIPT_REASONING env overrides expandScript reasoning via getReasoningLevel", () => {
    const prev = process.env.EXPAND_SCRIPT_REASONING;
    process.env.EXPAND_SCRIPT_REASONING = "high";
    try {
      assert.equal(getReasoningLevel(getCapability("expandScript")), "high");
      assert.equal(getReasoningLevel(getCapability("selectCreative")), "high");
    } finally {
      if (prev === undefined) delete process.env.EXPAND_SCRIPT_REASONING;
      else process.env.EXPAND_SCRIPT_REASONING = prev;
    }
  });

  it("resolveModel uses discovered Lite IDs and ignores GEMINI_MODEL for volc", () => {
    process.env.GEMINI_MODEL = "gemini-should-not-apply";
    delete process.env.ARK_MODEL_LITE;
    delete process.env.ARK_MODEL_PRO;
    assert.equal(resolveModel(getCapability("understandText")), VOLC_DISCOVERED_LITE_ID);
    assert.equal(resolveModel(getCapability("generateCreative")), VOLC_DISCOVERED_LITE_ID);
    assert.equal(resolveModel(getCapability("understandVideo")), VOLC_DISCOVERED_LITE_ID);
    assert.equal(getArkLiteModelId(), VOLC_DISCOVERED_LITE_ID);
    assert.equal(getArkProModelId(), VOLC_DISCOVERED_PRO_ID);
  });

  it("ARK_MODEL_* env overrides concrete ids", () => {
    process.env.ARK_MODEL_LITE = "ep-lite-test";
    process.env.ARK_MODEL_PRO = "ep-pro-test";
    assert.equal(resolveVolcModelId(VOLC_LOGICAL_LITE), "ep-lite-test");
    assert.equal(resolveModel(getCapability("understandText")), "ep-lite-test");
  });

  it("key resolution prefers SEED_2_1_LITE_API over AI_<cap> / ARK_API_KEY", () => {
    process.env.SEED_2_1_LITE_API = "seed-lite-key";
    process.env.AI_understandText = "ark-cap-key";
    process.env.ARK_API_KEY = "ark-fallback";
    assert.equal(getArkApiKeyForCapability("understandText"), "seed-lite-key");
    delete process.env.SEED_2_1_LITE_API;
    assert.equal(getArkApiKeyForCapability("understandText"), "ark-cap-key");
    delete process.env.AI_understandText;
    assert.equal(getArkApiKeyForCapability("understandText"), "ark-fallback");
  });

  it("Pro logical model resolves SEED_2_1_PRO_API", () => {
    process.env.SEED_2_1_PRO_API = "seed-pro-key";
    process.env.SEED_2_1_LITE_API = "seed-lite-key";
    assert.equal(
      getArkApiKeyForCapability("understandVideo", VOLC_LOGICAL_PRO),
      "seed-pro-key",
    );
  });

  it("Pro logical model falls back to SEED_2_1_LITE_API when Pro unset", () => {
    delete process.env.SEED_2_1_PRO_API;
    process.env.SEED_2_1_LITE_API = "seed-lite-key";
    assert.equal(
      getArkApiKeyForCapability("expandScript", VOLC_LOGICAL_PRO),
      "seed-lite-key",
    );
  });

  it("reasoning maps to thinking.enabled + same effort string", () => {
    const p = toArkThinkingParams("high");
    assert.deepEqual(p.thinking, { type: "enabled" });
    assert.equal(p.reasoning_effort, "high");
  });

  it("override runner does not mutate registry entry", async () => {
    const before = { ...getCapability("generateCreative") };
    const runner = makeOverrideRunner({
      model: "ep-override-only",
      reasoningLevel: "minimal",
    });
    await runCapability<{ ok: boolean }>(
      "generateCreative",
      {
        responseJsonSchema: { type: "object" },
        contents: "{}",
      },
      {
        runner: {
          async runCapability<T>() {
            return {
              data: { ok: true } as T,
              usage: {
                capability: "generateCreative" as const,
                provider: "volcengine" as const,
                model: "ep-override-only",
                promptVersion: CREATIVE_PROMPT_VERSION,
                reasoningLevel: "minimal" as const,
                status: "ok" as const,
                latencyMs: 1,
                cached: false,
              },
            };
          },
        },
      },
    );
    assert.equal(getCapability("generateCreative").model, before.model);
    assert.equal(
      getCapability("generateCreative").reasoningLevel,
      before.reasoningLevel,
    );
    assert.ok(runner);
  });
});

describe("volcengine adapter payload (mock / no network)", () => {
  it("builds multimodal request with image_url data URI", () => {
    const body = buildVolcChatBody({
      model: VOLC_DISCOVERED_LITE_ID,
      reasoningLevel: "minimal",
      responseJsonSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: "describe" },
            {
              inlineData: {
                mimeType: "image/png",
                data: "AAAA",
              },
            },
          ],
        },
      ],
    });
    assert.equal(body.model, VOLC_DISCOVERED_LITE_ID);
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, "minimal");
    const messages = body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    assert.equal(messages.length, 1);
    const parts = messages[0].content as Array<Record<string, unknown>>;
    assert.equal(parts[0].type, "text");
    assert.equal(parts[1].type, "image_url");
    const img = parts[1].image_url as { url: string };
    assert.ok(img.url.startsWith("data:image/png;base64,"));
  });

  it("string contents become a single user message", () => {
    const msgs = toArkMessages("hello", "sys");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs[1].content, "hello");
  });

  it("json_schema response_format for object schemas", () => {
    const fmt = buildVolcResponseFormat({
      type: "object",
      properties: { a: { type: "string" } },
    });
    assert.equal(fmt.type, "json_schema");
    assert.equal(
      (fmt.json_schema as { name: string }).name,
      "capability_response",
    );
  });

  it("classifies quota / timeout / validation errors", () => {
    assert.equal(classifyVolcError(new Error("HTTP 429 rate limit")).errorType, "quota");
    assert.equal(classifyVolcError(new Error("request timeout")).errorType, "timeout");
    assert.equal(
      classifyVolcError(new Error("returned non-JSON")).errorType,
      "validation",
    );
    assert.equal(
      classifyVolcError(new Error("HTTP 503 unavailable")).retryable,
      true,
    );
  });
});

describe("debug stopAfter helpers (V2)", () => {
  it("stepsThrough / stepsFrom / aliases", () => {
    assert.ok(isDebugPipelineStepId("generateCreative"));
    assert.ok(!isDebugPipelineStepId("concepts"));
    assert.deepEqual(stepsThrough("brief").slice(-1), ["brief"]);
    assert.equal(stepsFrom("generateCreative", "expandScript")[0], "generateCreative");
    assert.equal(STOP_AFTER_ALIASES.pi, "productUnderstanding");
    assert.equal(STOP_AFTER_ALIASES.concepts, "generateCreative");
    assert.equal(STOP_AFTER_ALIASES.generateCreative, "generateCreative");
  });
});
