import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  previewSeedanceModelLabel,
  resolveSeedancePreviewTier,
  seedancePreviewTierEnvVar,
} from "./seedance-preview-tier";

describe("seedance preview tier", () => {
  const prev = process.env.SEEDANCE_PREVIEW_TIER;

  afterEach(() => {
    if (prev === undefined) delete process.env.SEEDANCE_PREVIEW_TIER;
    else process.env.SEEDANCE_PREVIEW_TIER = prev;
  });

  it("defaults to 2.5 (r2v path)", () => {
    delete process.env.SEEDANCE_PREVIEW_TIER;
    assert.equal(resolveSeedancePreviewTier(), "2.5");
    assert.equal(seedancePreviewTierEnvVar(), "SEEDANCE_2_5_API");
    assert.equal(previewSeedanceModelLabel(), "Seedance 2.5");
  });

  it("honors mini for rollback", () => {
    process.env.SEEDANCE_PREVIEW_TIER = "mini";
    assert.equal(resolveSeedancePreviewTier(), "mini");
    assert.equal(seedancePreviewTierEnvVar(), "SEEDANCE_2_0_MINI_API");
    assert.equal(previewSeedanceModelLabel(), "Seedance 2.0 Mini");
  });

  it("honors pro-fast for testing", () => {
    process.env.SEEDANCE_PREVIEW_TIER = "pro-fast";
    assert.equal(resolveSeedancePreviewTier(), "pro-fast");
    assert.equal(seedancePreviewTierEnvVar(), "SEEDANCE_1_0_PRO_FAST_API");
    assert.match(previewSeedanceModelLabel(), /Pro Fast/);
  });

  it("honors 2.5 (r2v path)", () => {
    process.env.SEEDANCE_PREVIEW_TIER = "2.5";
    assert.equal(resolveSeedancePreviewTier(), "2.5");
    assert.equal(seedancePreviewTierEnvVar(), "SEEDANCE_2_5_API");
    assert.equal(previewSeedanceModelLabel(), "Seedance 2.5");
  });
});
