import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isComposeBgmEnabled,
  pickBgmTrack,
} from "./musicLibrary";

describe("compose BGM kill-switch", () => {
  const prev = process.env.COMPOSE_BGM;

  afterEach(() => {
    if (prev === undefined) delete process.env.COMPOSE_BGM;
    else process.env.COMPOSE_BGM = prev;
  });

  it("enabled by default when COMPOSE_BGM unset", () => {
    delete process.env.COMPOSE_BGM;
    assert.equal(isComposeBgmEnabled(), true);
  });

  it("disabled when COMPOSE_BGM=0", () => {
    process.env.COMPOSE_BGM = "0";
    assert.equal(isComposeBgmEnabled(), false);
    assert.equal(pickBgmTrack("warm soft"), null);
  });

  it("re-enabled when COMPOSE_BGM=1", () => {
    process.env.COMPOSE_BGM = "1";
    assert.equal(isComposeBgmEnabled(), true);
  });
});
