import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { referenceRoleForTier } from "./volcengine-seedance";

describe("Seedance referenceRoleForTier", () => {
  it("keeps reference_image for Mini and 2.5 (r2v)", () => {
    assert.equal(referenceRoleForTier("mini"), "reference_image");
    assert.equal(referenceRoleForTier("mini", "reference_image"), "reference_image");
    assert.equal(referenceRoleForTier("2.5", "reference_image"), "reference_image");
  });

  it("coerces reference_image → first_frame for Pro Fast (no r2v)", () => {
    assert.equal(referenceRoleForTier("pro-fast"), "first_frame");
    assert.equal(
      referenceRoleForTier("pro-fast", "reference_image"),
      "first_frame",
    );
  });

  it("preserves explicit first_frame on every tier", () => {
    assert.equal(referenceRoleForTier("mini", "first_frame"), "first_frame");
    assert.equal(referenceRoleForTier("pro-fast", "first_frame"), "first_frame");
  });
});
