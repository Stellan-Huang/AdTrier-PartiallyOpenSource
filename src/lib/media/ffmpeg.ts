/**
 * Resolve ffmpeg / media duration on local + Vercel serverless.
 * Prefer system binaries; fall back to bundled ffmpeg-static.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let cachedFfmpeg: string | null | undefined;
let cachedFfprobe: string | null | undefined;

function tryBinary(bin: string, versionFlag = "-version"): boolean {
  const run = spawnSync(bin, [versionFlag], { encoding: "utf8" });
  return run.status === 0;
}

/** Absolute path to an executable ffmpeg, or null. */
export function resolveFfmpegPath(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;

  // Test / ops override — absolute path to a specific binary (e.g. ffmpeg-static).
  const forced = process.env.ADTRIER_FFMPEG_BIN?.trim();
  if (forced && existsSync(forced) && tryBinary(forced)) {
    cachedFfmpeg = forced;
    return cachedFfmpeg;
  }

  if (tryBinary("ffmpeg")) {
    cachedFfmpeg = "ffmpeg";
    return cachedFfmpeg;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath && existsSync(staticPath) && tryBinary(staticPath)) {
      cachedFfmpeg = staticPath;
      return cachedFfmpeg;
    }
  } catch {
    // package missing / unsupported platform
  }

  cachedFfmpeg = null;
  return null;
}

/**
 * Pull the real failure reason from ffmpeg output.
 * Static builds dump a long version/config banner first — slicing stderr[0:400]
 * otherwise surfaces only "ffmpeg version …" to users.
 */
export function summarizeFfmpegFailure(
  stderr: string,
  stdout = "",
  max = 400,
): string {
  const text = `${stderr || ""}\n${stdout || ""}`;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^ffmpeg version\b/i.test(l) &&
        !/^built with\b/i.test(l) &&
        !/^configuration:\s/i.test(l) &&
        !/^lib\w+\s+.*copyright/i.test(l),
    );
  const interesting = lines.filter((l) =>
    /error|fail|no such|unknown|invalid|cannot|not found|denied|refused/i.test(
      l,
    ),
  );
  const picked = (interesting.length ? interesting.slice(-8) : lines.slice(-6))
    .join(" | ");
  return (picked || "unknown ffmpeg error").slice(0, max);
}

/** Absolute path to ffprobe when available (system only — ffmpeg-static has no ffprobe). */
export function resolveFfprobePath(): string | null {
  if (cachedFfprobe !== undefined) return cachedFfprobe;
  cachedFfprobe = tryBinary("ffprobe") ? "ffprobe" : null;
  return cachedFfprobe;
}

export function hasFfmpeg(): boolean {
  return resolveFfmpegPath() !== null;
}

/** @internal test helper */
export function resetFfmpegPathCache(): void {
  cachedFfmpeg = undefined;
  cachedFfprobe = undefined;
}

function parseFfmpegDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const h = Number.parseInt(m[1]!, 10);
  const min = Number.parseInt(m[2]!, 10);
  const sec = Number.parseFloat(m[3]!);
  if (![h, min, sec].every((n) => Number.isFinite(n))) return null;
  const total = h * 3600 + min * 60 + sec;
  return total > 0 ? total : null;
}

/**
 * Probe media duration via system ffprobe, else ffmpeg -i Duration line.
 */
export function probeMediaDurationSec(filePath: string): number | null {
  if (!filePath || !existsSync(filePath)) return null;

  const ffprobe = resolveFfprobePath();
  if (ffprobe) {
    const probe = spawnSync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8" },
    );
    if (probe.status === 0) {
      const n = Number.parseFloat((probe.stdout || "").trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return null;
  const run = spawnSync(ffmpeg, ["-i", filePath], { encoding: "utf8" });
  // ffmpeg -i exits non-zero without output file; Duration is on stderr.
  return parseFfmpegDuration(`${run.stderr || ""}\n${run.stdout || ""}`);
}

/**
 * Estimate MP3 duration from buffer (Xing/Info frame count, else CBR bitrate).
 */
export function estimateMp3DurationSec(bytes: Buffer): number | null {
  if (!bytes || bytes.length < 4) return null;

  // Skip ID3v2
  let offset = 0;
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const size =
      ((bytes[6]! & 0x7f) << 21) |
      ((bytes[7]! & 0x7f) << 14) |
      ((bytes[8]! & 0x7f) << 7) |
      (bytes[9]! & 0x7f);
    offset = 10 + size;
  }

  // Find first MPEG frame sync
  while (offset + 4 < bytes.length) {
    if (bytes[offset] === 0xff && (bytes[offset + 1]! & 0xe0) === 0xe0) break;
    offset += 1;
  }
  if (offset + 4 >= bytes.length) return null;

  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }

  // MPEG-1 Layer III tables (common for OpenSpeech mp3)
  const isMpeg1 = versionBits === 3;
  const isLayer3 = layerBits === 1;
  if (!isLayer3) {
    // Still try CBR with MPEG-1 L3 table when possible; else bail to CBR guess below
  }

  const mpeg1L3Bitrates = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
  ];
  const mpeg2L3Bitrates = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
  ];
  const mpeg1Rates = [44100, 48000, 32000];
  const mpeg2Rates = [22050, 24000, 16000];

  const bitrateKbps = isMpeg1
    ? mpeg1L3Bitrates[bitrateIndex]
    : mpeg2L3Bitrates[bitrateIndex];
  const sampleRate = isMpeg1
    ? mpeg1Rates[sampleRateIndex]
    : mpeg2Rates[sampleRateIndex];
  if (!bitrateKbps || !sampleRate) return null;

  const samplesPerFrame = isMpeg1 ? 1152 : 576;

  // Xing / Info VBR header (after side info)
  const channelMode = (bytes[offset + 3]! >> 6) & 0x03;
  const channels = channelMode === 3 ? 1 : 2;
  const sideInfo = isMpeg1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
  const xingAt = offset + 4 + sideInfo;
  if (xingAt + 12 < bytes.length) {
    const tag = bytes.toString("ascii", xingAt, xingAt + 4);
    if (tag === "Xing" || tag === "Info") {
      const flags = bytes.readUInt32BE(xingAt + 4);
      if (flags & 0x00000001) {
        const frames = bytes.readUInt32BE(xingAt + 8);
        if (frames > 0) {
          const dur = (frames * samplesPerFrame) / sampleRate;
          return dur > 0 ? dur : null;
        }
      }
    }
  }

  // CBR: (file bytes after ID3) * 8 / bitrate
  const audioBytes = bytes.length - offset;
  const dur = (audioBytes * 8) / (bitrateKbps * 1000);
  return dur > 0.05 ? dur : null;
}

export type ResolveAudioDurationInput = {
  filePath: string;
  /** Raw TTS bytes when available (avoids re-read). */
  bytes?: Buffer;
  /** Duration from TTS API usage/session metadata when present. */
  apiHintSec?: number;
};

/**
 * Resolve audio duration: API hint → ffprobe/ffmpeg probe → MP3 estimate.
 * Throws a clear error when none succeed.
 */
export function resolveAudioDurationSec(input: ResolveAudioDurationInput): number {
  const hint = input.apiHintSec;
  if (typeof hint === "number" && Number.isFinite(hint) && hint > 0) {
    return hint;
  }

  const probed = probeMediaDurationSec(input.filePath);
  if (probed) return probed;

  let buf = input.bytes;
  if (!buf && input.filePath && existsSync(input.filePath)) {
    try {
      buf = readFileSync(input.filePath);
    } catch {
      buf = undefined;
    }
  }
  if (buf) {
    const estimated = estimateMp3DurationSec(buf);
    if (estimated) return estimated;
  }

  throw new Error(
    "TTS response missing durationSec — no API duration, ffprobe/ffmpeg unavailable or failed, and MP3 header estimate failed",
  );
}

/** Run ffmpeg with resolved binary (system or static). */
export function runFfmpeg(
  args: string[],
  opts?: { encoding?: "utf8" },
): ReturnType<typeof spawnSync> {
  const bin = resolveFfmpegPath();
  if (!bin) {
    return {
      status: 127,
      signal: null,
      output: ["", "", "ffmpeg not available"],
      pid: 0,
      stdout: "",
      stderr: "ffmpeg not available",
      error: new Error("ffmpeg not available"),
    } as ReturnType<typeof spawnSync>;
  }
  return spawnSync(bin, args, { encoding: opts?.encoding ?? "utf8" });
}
