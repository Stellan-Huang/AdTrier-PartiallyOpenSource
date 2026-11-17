import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  estimateMp3DurationSec,
  hasFfmpeg,
  probeMediaDurationSec,
  resolveAudioDurationSec,
  resolveFfmpegPath,
  resetFfmpegPathCache,
  runFfmpeg,
} from "./ffmpeg";

/** Minimal CBR MPEG-1 Layer III frame header @ 128kbps / 44.1kHz stereo. */
function fakeCbrMp3(byteLength: number): Buffer {
  const buf = Buffer.alloc(byteLength, 0);
  // Frame sync + MPEG1 Layer3 + 128kbps + 44100 + stereo
  buf[0] = 0xff;
  buf[1] = 0xfb; // 1111 1011 — MPEG1, Layer3, no CRC
  buf[2] = 0x90; // 1001 0000 — 128kbps, 44100
  buf[3] = 0xc4; // stereo + rest
  return buf;
}

describe("media/ffmpeg", () => {
  it("resolves a working ffmpeg binary (system or static)", () => {
    resetFfmpegPathCache();
    const path = resolveFfmpegPath();
    assert.ok(path, "expected ffmpeg path");
    assert.equal(hasFfmpeg(), true);
    const ver = runFfmpeg(["-version"]);
    assert.equal(ver.status, 0);
  });

  it("estimates CBR MP3 duration from buffer without ffprobe", () => {
    // ~128kbps → 1 second ≈ 16000 bytes
    const bytes = fakeCbrMp3(16000);
    const dur = estimateMp3DurationSec(bytes);
    assert.ok(dur !== null);
    assert.ok(dur! > 0.8 && dur! < 1.3, `got ${dur}`);
  });

  it("prefers API duration hint over probe/estimate", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtrier-ffmpeg-"));
    const path = join(dir, "empty.mp3");
    writeFileSync(path, Buffer.from([0x00, 0x01]));
    const dur = resolveAudioDurationSec({
      filePath: path,
      bytes: Buffer.from([0x00]),
      apiHintSec: 12.5,
    });
    assert.equal(dur, 12.5);
  });

  it("falls back to MP3 estimate when hint missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtrier-ffmpeg-"));
    const bytes = fakeCbrMp3(32000);
    const path = join(dir, "vo.mp3");
    writeFileSync(path, bytes);
    // Force estimate path by using nonsense file that probe may fail on —
    // if probe works via ffmpeg-static, either path is fine (>0).
    const dur = resolveAudioDurationSec({ filePath: path, bytes });
    assert.ok(dur > 1.5 && dur < 3.0, `got ${dur}`);
  });

  it("throws a clear error when duration cannot be resolved", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtrier-ffmpeg-"));
    const path = join(dir, "junk.bin");
    writeFileSync(path, Buffer.from([0x00, 0x01, 0x02]));
    assert.throws(
      () => resolveAudioDurationSec({ filePath: path, bytes: Buffer.from([0]) }),
      /missing durationSec|MP3 header estimate failed|ffprobe/,
    );
  });

  it("probeMediaDurationSec can read a real short mp3 via ffmpeg", () => {
    resetFfmpegPathCache();
    if (!hasFfmpeg()) return;
    const dir = mkdtempSync(join(tmpdir(), "adtrier-ffmpeg-"));
    const path = join(dir, "tone.mp3");
    // Generate 0.5s sine via ffmpeg — proves static binary works for probe path.
    const enc = runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "9",
      path,
    ]);
    assert.equal(enc.status, 0, String(enc.stderr).slice(0, 200));
    const dur = probeMediaDurationSec(path);
    assert.ok(dur !== null);
    assert.ok(dur! > 0.35 && dur! < 0.8, `probed ${dur}`);
  });
});
