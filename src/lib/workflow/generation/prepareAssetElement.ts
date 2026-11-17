/**
 * Helper (not a stage): extract a product CUTOUT (RGBA) for Hero Close / element
 * overlay. Never returns a rectangular ecommerce frame / original listing photo.
 *
 * Extract failure ⇒ throw (caller: mid-shot skip product; Hero Close optional).
 * Primary: corner-sampled colorkey. Gate: transparency band + ≥3 transparent corners.
 * backgroundkey is NOT used (static images → 100% transparent false positive).
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { runFfmpeg } from "@/lib/media/ffmpeg";

export type PrepareAssetElementInput = {
  assetId: string;
  assetUrl: string;
  /** Max output edge in px (default 900). */
  sizePx?: number;
};

export type PrepareAssetElementResult = {
  elementUrl: string;
  assetId: string;
  latencyMs: number;
  provider: "ffmpeg";
  model: "product-cutout-rgba";
};

async function materializeLocal(url: string, dest: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    if (!existsSync(url)) {
      throw new Error(`prepareAssetElement local missing: ${url}`);
    }
    return url;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(
      `prepareAssetElement download failed HTTP ${res.status}: ${url}`,
    );
  }
  const nodeStream = Readable.fromWeb(
    res.body as import("node:stream/web").ReadableStream,
  );
  await pipeline(nodeStream, createWriteStream(dest));
  return dest;
}

/**
 * True when enough pixels are transparent (cutout worked) but not empty.
 * Reads raw alpha plane — never treats opaque rectangular card as success.
 */
export function cutoutHasTransparency(pngPath: string, workDir: string): boolean {
  const rawPath = join(workDir, "alpha.raw");
  const run = runFfmpeg([
    "-y",
    "-i",
    pngPath,
    "-vf",
    "alphaextract,format=gray",
    "-f",
    "rawvideo",
    rawPath,
  ]);
  if (run.status !== 0 || !existsSync(rawPath)) return false;
  const buf = readFileSync(rawPath);
  if (buf.length < 100) return false;
  let transparent = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i]! < 250) transparent += 1;
  }
  const ratio = transparent / buf.length;
  try {
    unlinkSync(rawPath);
  } catch {
    // ignore
  }
  // Need real cutout holes (>5%) but keep product (>5% opaque).
  return ratio > 0.05 && ratio < 0.95;
}

/**
 * True when ≥3 of 4 corners are transparent — real cutouts clear the frame edge.
 * Rejects "label dig-outs" that leave scene backgrounds intact.
 */
export function cutoutHasTransparentCorners(
  pngPath: string,
  workDir: string,
  minTransparentCorners = 3,
): boolean {
  const corners = [
    ["0", "0"],
    ["iw-1", "0"],
    ["0", "ih-1"],
    ["iw-1", "ih-1"],
  ];
  let clear = 0;
  for (const [x, y] of corners) {
    const sample = join(workDir, `alpha-corner-${x}-${y}.raw`);
    const run = runFfmpeg([
      "-y",
      "-i",
      pngPath,
      "-vf",
      `crop=1:1:${x}:${y},alphaextract,format=gray`,
      "-f",
      "rawvideo",
      sample,
    ]);
    if (run.status !== 0 || !existsSync(sample)) continue;
    try {
      const buf = readFileSync(sample);
      if (buf.length >= 1 && buf[0]! < 128) clear += 1;
      unlinkSync(sample);
    } catch {
      // ignore
    }
  }
  return clear >= minTransparentCorners;
}

function sampleCornerKeys(srcLocal: string, dir: string): string[] {
  const keys = new Set<string>(["0xFFFFFF", "0xF5F5F5", "0xFAFAFA", "0xEEEEEE"]);
  const corners = [
    ["0", "0"],
    ["iw-1", "0"],
    ["0", "ih-1"],
    ["iw-1", "ih-1"],
  ];
  for (const [x, y] of corners) {
    const sample = join(dir, `corner-${x}-${y}.ppm`);
    const run = runFfmpeg([
      "-y",
      "-i",
      srcLocal,
      "-vf",
      `crop=1:1:${x}:${y}`,
      "-frames:v",
      "1",
      sample,
    ]);
    if (run.status !== 0 || !existsSync(sample)) continue;
    try {
      const buf = readFileSync(sample);
      const idx = buf.indexOf(
        0x0a,
        buf.indexOf(0x0a, buf.indexOf(0x0a) + 1) + 1,
      );
      if (idx < 0 || buf.length < idx + 4) continue;
      const r = buf[idx + 1]!;
      const g = buf[idx + 2]!;
      const b = buf[idx + 3]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max >= 180 && max - min <= 45) {
        keys.add(
          `0x${r.toString(16).padStart(2, "0")}${g
            .toString(16)
            .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase(),
        );
      }
      unlinkSync(sample);
    } catch {
      // ignore
    }
  }
  return [...keys];
}

/**
 * Extract without square pad first — corner gate must see the true image edges.
 * Transparent pad would otherwise make every cutout pass the 4-corner check.
 */
function runExtractRaw(
  srcLocal: string,
  outPath: string,
  vfCore: string,
): boolean {
  const vf = [vfCore, "format=rgba"].join(",");
  const run = runFfmpeg([
    "-y",
    "-i",
    srcLocal,
    "-vf",
    vf,
    "-update",
    "1",
    "-frames:v",
    "1",
    outPath,
  ]);
  return run.status === 0 && existsSync(outPath);
}

function padCutoutToSquare(rawPath: string, outPath: string, size: number): boolean {
  const vf = [
    `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    "format=rgba",
  ].join(",");
  const run = runFfmpeg([
    "-y",
    "-i",
    rawPath,
    "-vf",
    vf,
    "-update",
    "1",
    "-frames:v",
    "1",
    outPath,
  ]);
  return run.status === 0 && existsSync(outPath);
}

function cutoutPassesGate(pngPath: string, workDir: string): boolean {
  return (
    cutoutHasTransparency(pngPath, workDir) &&
    cutoutHasTransparentCorners(pngPath, workDir, 3)
  );
}

/**
 * Extract product cutout with transparency. Throws on failure —
 * NEVER returns the original rectangular listing image.
 */
export async function prepareAssetElement(
  input: PrepareAssetElementInput,
): Promise<PrepareAssetElementResult> {
  if (!input.assetUrl) {
    throw new Error(
      `prepareAssetElement: asset ${input.assetId} has no URL`,
    );
  }
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "adtrier-element-"));
  const size = input.sizePx ?? 900;
  const srcLocal = await materializeLocal(
    input.assetUrl,
    join(dir, "src.bin"),
  );
  const outPath = join(dir, `${input.assetId}-cutout.png`);
  const rawPath = join(dir, `${input.assetId}-raw.png`);

  // No backgroundkey — on stills it yields 100% transparent false positives.
  const keys = sampleCornerKeys(srcLocal, dir);
  const attempts: string[] = [
    keys.map((k) => `colorkey=${k}:0.35:0.16`).join(","),
    ["0xFFFFFF", "0xF8F8F8", "0xF0F0F0"]
      .map((k) => `colorkey=${k}:0.45:0.2`)
      .join(","),
  ];

  let ok = false;
  for (const core of attempts) {
    if (!runExtractRaw(srcLocal, rawPath, core)) continue;
    // Gate on unpadded edges — reject scene photos that keep opaque corners.
    if (!cutoutPassesGate(rawPath, dir)) continue;
    if (!padCutoutToSquare(rawPath, outPath, size)) continue;
    ok = true;
    break;
  }

  if (!ok) {
    writeFileSync(
      join(dir, "extract-failed.txt"),
      `asset=${input.assetId}\nattempts=${attempts.length}\ngate=transparency+corners\n`,
      "utf8",
    );
    throw new Error(
      `prepareAssetElement extract failed for ${input.assetId} — extract-fail ≠ show original`,
    );
  }

  return {
    elementUrl: outPath,
    assetId: input.assetId,
    latencyMs: Date.now() - started,
    provider: "ffmpeg",
    model: "product-cutout-rgba",
  };
}
