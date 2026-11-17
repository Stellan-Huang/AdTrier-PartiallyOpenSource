import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAssDocument,
  burnAssCaptions,
  captionTextForScene,
  formatAssTime,
  wrapCaptionLines,
  writeAssFile,
} from "./captions";
import {
  hasFfmpeg,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  runFfmpeg,
} from "@/lib/media/ffmpeg";

describe("captions helpers", () => {
  it("formats ASS clock times", () => {
    assert.equal(formatAssTime(0), "0:00:00.00");
    assert.equal(formatAssTime(1.5), "0:00:01.50");
    assert.equal(formatAssTime(65.02), "0:01:05.02");
  });

  it("wraps caption lines with real newlines (ASS \\N applied later)", () => {
    const wrapped = wrapCaptionLines(
      "Meet the bottle that keeps drinks colder longer every day",
      28,
      2,
    );
    assert.ok(wrapped.includes("\n"));
    assert.equal(wrapped.split("\n").length, 2);
  });

  it("does not paint literal backslash for wrapped Dialogue lines", () => {
    const ass = buildAssDocument({
      playResX: 720,
      playResY: 1280,
      cues: [
        {
          startSec: 0,
          endSec: 3,
          text: "That tight, just-cleansed feeling doesn't have to be normal.",
          style: "caption",
        },
      ],
    });
    const dialogue = ass.split("\n").find((l) => l.startsWith("Dialogue:"));
    assert.ok(dialogue);
    // Hard break must be a single ASS `\N`, not escaped `\\N` (literal `\`).
    assert.match(dialogue!, /cleansed\\Nfeeling/);
    assert.doesNotMatch(dialogue!, /\\\\N/);
  });

  it("prefers voiceover over on-screen text", () => {
    assert.equal(
      captionTextForScene({
        voiceover: "Stay cool all day",
        text: "Short card",
      }),
      "Stay cool all day",
    );
    assert.equal(
      captionTextForScene({ text: "Short card" }),
      "Short card",
    );
  });

  it("builds ASS with Caption + Brand styles", () => {
    const ass = buildAssDocument({
      playResX: 720,
      playResY: 1280,
      cues: [
        {
          startSec: 0,
          endSec: 2,
          text: "Hook line here",
          style: "caption",
        },
        {
          startSec: 2,
          endSec: 4,
          text: "BrandCo",
          style: "brand",
        },
      ],
    });
    assert.match(ass, /Style: Caption,/);
    assert.match(ass, /Style: Brand,/);
    assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:02\.00,Caption,/);
    assert.match(ass, /Dialogue: 0,0:00:02\.00,0:00:04\.00,Brand,/);
    assert.match(ass, /Hook line here/);
  });

  it("uses larger Caption Fontsize (~2–3 sizes up at 720x1280)", () => {
    const ass = buildAssDocument({
      playResX: 720,
      playResY: 1280,
      cues: [{ startSec: 0, endSec: 1, text: "Size check", style: "caption" }],
    });
    // Prior formula was max(28, round(1280/36)) = 36; new = round(1280/29) = 44.
    assert.match(ass, /Style: Caption,DejaVu Sans,44,/);
  });
});

describe("burnAssCaptions", () => {
  it("burns ASS onto a short MP4 when FFmpeg is available", () => {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath || !existsSync(ffmpegPath)) return;

    const prev = process.env.ADTRIER_FFMPEG_BIN;
    process.env.ADTRIER_FFMPEG_BIN = ffmpegPath;
    resetFfmpegPathCache();

    try {
      assert.equal(hasFfmpeg(), true);
      const dir = mkdtempSync(join(tmpdir(), "adtrier-cap-"));
      const src = join(dir, "src.mp4");
      const out = join(dir, "out.mp4");
      const enc = runFfmpeg([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=720x1280:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        src,
      ]);
      assert.equal(enc.status, 0, String(enc.stderr).slice(0, 200));
      const assPath = writeAssFile(
        dir,
        "t",
        [{ startSec: 0, endSec: 1, text: "Hello captions", style: "caption" }],
        { width: 720, height: 1280 },
      );
      assert.ok(existsSync(assPath));
      burnAssCaptions({ inputPath: src, outputPath: out, assPath });
      assert.ok(existsSync(out));
    } finally {
      if (prev === undefined) delete process.env.ADTRIER_FFMPEG_BIN;
      else process.env.ADTRIER_FFMPEG_BIN = prev;
      resetFfmpegPathCache();
    }
  });

  it("writes ass file to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtrier-ass-"));
    const path = writeAssFile(
      dir,
      "cues",
      [{ startSec: 0, endSec: 1.2, text: "Line one", style: "caption" }],
      { width: 720, height: 1280 },
    );
    assert.ok(existsSync(path));
    writeFileSync(join(dir, "probe.txt"), "ok");
  });
});
