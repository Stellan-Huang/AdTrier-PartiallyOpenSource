import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  getCacheDir,
  useTmpUnderstandingCache,
  writeCache,
  readCache,
  cachePath,
} from "./cache";

const PREV_VERCEL = process.env.VERCEL;
const PREV_TMP = process.env.UNDERSTANDING_CACHE_TO_TMP;

afterEach(() => {
  if (PREV_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = PREV_VERCEL;
  if (PREV_TMP === undefined) delete process.env.UNDERSTANDING_CACHE_TO_TMP;
  else process.env.UNDERSTANDING_CACHE_TO_TMP = PREV_TMP;
});

describe("understanding cache dir", () => {
  it("uses /tmp/.data/understanding-cache when VERCEL=1", () => {
    process.env.VERCEL = "1";
    delete process.env.UNDERSTANDING_CACHE_TO_TMP;
    assert.equal(useTmpUnderstandingCache(), true);
    assert.equal(getCacheDir(), join("/tmp", ".data", "understanding-cache"));
  });

  it("uses cwd .data/understanding-cache in local/dev", () => {
    delete process.env.VERCEL;
    delete process.env.UNDERSTANDING_CACHE_TO_TMP;
    assert.equal(useTmpUnderstandingCache(), false);
    assert.equal(
      getCacheDir(),
      join(process.cwd(), ".data", "understanding-cache"),
    );
  });

  it("honors UNDERSTANDING_CACHE_TO_TMP=1", () => {
    delete process.env.VERCEL;
    process.env.UNDERSTANDING_CACHE_TO_TMP = "1";
    assert.equal(useTmpUnderstandingCache(), true);
    assert.equal(getCacheDir(), join("/tmp", ".data", "understanding-cache"));
  });

  it("round-trips under /tmp when VERCEL=1", () => {
    process.env.VERCEL = "1";
    const key = `test_${Date.now().toString(36)}`;
    writeCache(key, { ok: true });
    assert.ok(cachePath(key).startsWith(join("/tmp", ".data")));
    assert.deepEqual(readCache<{ ok: boolean }>(key), { ok: true });
  });
});
