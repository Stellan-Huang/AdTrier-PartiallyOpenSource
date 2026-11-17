/**
 * Helper (not a stage): concat scenes + mux VO/BGM/SFX via system ffmpeg (9:16).
 * Tests inject composeFn. Missing ffmpeg on real path → fail closed.
 *
 * Product overlays only when a cutout elementUrl exists (never original rect card).
 * Hero Close primary path is Mini reference_image; cutout overlay is optional.
 * Empty BGM/SFX libraries = silent OK (still loudnorm VO → 48k stereo).
 */

import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  hasFfmpeg,
  probeMediaDurationSec,
  runFfmpeg,
} from "@/lib/media/ffmpeg";
import {
  burnAssCaptions,
  captionTextForScene,
  writeAssFile,
  type CaptionCue,
} from "@/lib/video/captions";
import type { AdSpec, GeneratedSceneMedia } from "./types";
import type { GenerationQuality } from "./resolveScene";
import { pickBgmTrack } from "./audio/musicLibrary";
import { pickSfxForAction, type SfxCue } from "./audio/sfxLibrary";

export type ComposeAdInput = {
  adSpec: AdSpec;
  scenes: GeneratedSceneMedia[];
  voiceoverUrl: string;
  /** Brand lockup for Hero Close drawtext. */
  brandLockup?: {
    brand: string;
    claim?: string;
  };
};

/** Cached locals from a prior compose — enables Hero-window ss change without full re-download/re-encode. */
export type ComposeWorkspace = {
  dir: string;
  voiceLocal: string;
  sceneLocals: string[];
  elementLocals: Array<string | null>;
  normPaths: string[];
  heroExtraSec: number;
  width: number;
  height: number;
  fontFile: string;
  quality: GenerationQuality;
  audioIn?: string;
  mixDur?: number;
};

export type ComposeAdResult = {
  composedUrl: string;
  latencyMs: number;
  provider: string;
  model: string;
  width?: number;
  height?: number;
  finalDurationSec?: number;
  bgmUsed?: boolean;
  sfxCount?: number;
  /** Deterministic Hero overlay visibility (pixel diff). */
  heroVisible?: boolean;
  /** Present when keepWorkspace — reuse for Hero ss-only retries. */
  workspace?: ComposeWorkspace;
  /** true when only Hero was re-encoded (window adjust). */
  heroOnlyReencode?: boolean;
  /**
   * Per-scene normalized MP4s (post overlay/text, pre-concat).
   * Seedance does not return finished shot ads — these compose intermediates
   * are the durable shot clips for Preview/Final panels.
   */
  shotLocalPaths?: string[];
};

export type ComposeAdOptions = {
  /** Test / CI injection — bypass ffmpeg. */
  composeFn?: (input: ComposeAdInput) => Promise<ComposeAdResult>;
  /** Output file path hint (real ffmpeg path). */
  outputPath?: string;
  generationQuality?: GenerationQuality;
  /** Target timeline seconds (default 15). Hero motion capped; freeze pads remainder. */
  targetDurationSec?: number;
  /**
   * Where to take Hero Close from a longer Mini clip.
   * Default `tail` (pouch already settled). Used by QA window retries.
   */
  heroWindow?: "tail" | "mid" | "head";
  /** Keep temp workspace on result for Hero-window re-encode. */
  keepWorkspace?: boolean;
  /**
   * Reuse a prior workspace: change Hero `ss` only, skip narrative re-encode
   * and re-download. Never burns Seedance.
   */
  reuseWorkspace?: ComposeWorkspace;
};

const PREVIEW_W = 720;
const PREVIEW_H = 1280;
const PROD_W = 1080;
const PROD_H = 1920;
const DEFAULT_TARGET_SEC = 15;
/** Soft wrap at nearest space before this many characters. */
const TEXT_WRAP_CHARS = 26;
/** Cap subtitle density — VO fallback can be long; keep ≤2 lines on screen. */
const SUBTITLE_MAX_LINES = 2;
/** Drop Mini tail montage flashes on non-Hero scenes when media allows. */
const MINI_TAIL_DISCARD_SEC = 0.6;
/**
 * Hero Seedance / motion take cap — short still pouch shot; compose freezes
 * the last frame to fill remaining Hero timeline (avoids settle/cup open).
 */
export const HERO_MOTION_MAX_SEC = 4;
/**
 * End-card Brand/Product ASS: short beat after Hero Close (final showcase)
 * begins, then hold through scene/video end — not delayed to the freeze tail.
 * Range guidance: 0.3–0.8s; use low end so lockup reads early in the hold.
 */
export const HERO_LOCKUP_CAPTION_DELAY_SEC = 0.3;
/** Prefer skipping at least this much open settle when media allows. */
const HERO_MIN_SKIP_OPEN_SEC = 1.0;

function findFont(): string {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "";
}

/** Escape a local path for ffmpeg filtergraph (textfile=/fontfile=). */
function escapeFilterPath(path: string): string {
  return path
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

/** Wrap long copy at the last space before maxChars; textfile supports newlines. */
export function wrapDrawtextLines(
  text: string,
  maxChars = TEXT_WRAP_CHARS,
  maxLines = SUBTITLE_MAX_LINES,
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) {
        cur = "";
        break;
      }
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.join("\n");
}

function writeDrawtextFile(dir: string, basename: string, text: string): string {
  const path = join(dir, `${basename}.txt`);
  writeFileSync(path, wrapDrawtextLines(text), "utf8");
  return path;
}

/**
 * Subtle code motion for product cutouts.
 * Always loop still PNG first so fade=alpha does not stick on t=0 transparent frame.
 */
function motionOverlayFilter(
  primitive: string,
  width: number,
  height: number,
): string {
  const ew = Math.round(width * 0.62);
  const eh = Math.round(height * 0.5);
  const x = `(W-w)/2`;
  const y = `(H-h)/2`;
  const prep = `[1:v]loop=loop=-1:size=1:start=0,scale=${ew}:${eh}:force_original_aspect_ratio=decrease,format=rgba`;
  switch (primitive) {
    case "scale_in":
      return `${prep},fade=t=in:st=0:d=0.4:alpha=1[el];[bg][el]overlay=x='${x}':y='${y}':format=auto[vout]`;
    case "push_in":
      return `${prep}[el];[bg][el]overlay=x='${x}':y='H-h-${Math.round(height * 0.08)}+20*t':format=auto[vout]`;
    case "float":
      return `${prep}[el];[bg][el]overlay=x='${x}':y='${y}+8*sin(2*PI*t/2)':format=auto[vout]`;
    case "light_sweep":
      return `${prep},fade=t=in:st=0:d=0.35:alpha=1[el];[bg][el]overlay=x='${x}':y='${y}+6*sin(2*PI*t/2.5)':format=auto[vout]`;
    case "fade":
    default:
      return `${prep},fade=t=in:st=0:d=0.5:alpha=1[el];[bg][el]overlay=x='${x}':y='${y}':format=auto[vout]`;
  }
}

/**
 * Legacy drawtext overlays — intentionally unused on the MAP Preview path.
 * ffmpeg-static (Vercel) has no drawtext; captions/brand burn via ASS after mux.
 * Kept as a no-op so normalize filters stay video-only and portable.
 */
function textOverlayFilters(
  _sceneSpec: AdSpec["scenes"][number] | undefined,
  _brandLockup: ComposeAdInput["brandLockup"] | undefined,
  _height: number,
  _fontFile: string,
  _dir: string,
  _sceneKey: string,
): string {
  return "";
}

/**
 * Legacy drawtext caption source — prefer short on-screen text; VO if text empty.
 * Soft-trimmed to ~8 words. Prefer `captionTextForScene` + ASS burn for Preview/Final
 * (ffmpeg-static has no drawtext).
 */
export function subtitleCopyForScene(
  scene: AdSpec["scenes"][number] | undefined,
): string {
  if (!scene || scene.isHeroClose) return "";
  const text = scene.text?.trim();
  if (text) return text;
  const vo = scene.voiceover?.trim() || "";
  if (!vo) return "";
  const words = vo.split(/\s+/).filter(Boolean);
  if (words.length <= 8) return vo;
  return words.slice(0, 8).join(" ");
}

/**
 * Build absolute-timeline ASS cues from AdSpec scenes + optional Hero brand lockup.
 * Used to burn captions onto the assembled MP4 (works with ffmpeg-static libass).
 */
export function buildComposeCaptionCues(
  adSpec: AdSpec,
  brandLockup?: ComposeAdInput["brandLockup"],
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const scene of adSpec.scenes) {
    const start = Math.max(0, scene.start);
    const end = Math.max(start + 0.2, scene.end);
    if (scene.isHeroClose) {
      // Product hold: Brand + product name only — never VO / fact / scene.text.
      // Appear shortly after showcase starts; stay through end of hold.
      const lockupStart = Math.min(
        end - 0.2,
        start + HERO_LOCKUP_CAPTION_DELAY_SEC,
      );
      if (brandLockup?.brand) {
        cues.push({
          startSec: Math.max(start, lockupStart),
          endSec: end,
          text: brandLockup.brand,
          style: "brand",
        });
        const claim = brandLockup.claim?.trim() || "";
        if (claim) {
          cues.push({
            startSec: Math.max(start, lockupStart),
            endSec: end,
            text: claim,
            style: "claim",
          });
        }
      }
      continue;
    }
    const caption = captionTextForScene(scene);
    if (caption) {
      cues.push({
        startSec: start,
        endSec: end,
        text: caption,
        style: "caption",
      });
    }
  }
  return cues;
}

/** Relative (0-based) cues for a single shot clip of known duration. */
export function buildShotCaptionCues(input: {
  scene: AdSpec["scenes"][number];
  durationSec: number;
  brandLockup?: ComposeAdInput["brandLockup"];
}): CaptionCue[] {
  const end = Math.max(0.2, input.durationSec);
  const cues: CaptionCue[] = [];
  if (input.scene.isHeroClose) {
    const lockupStart = Math.min(end - 0.2, HERO_LOCKUP_CAPTION_DELAY_SEC);
    if (input.brandLockup?.brand) {
      cues.push({
        startSec: Math.max(0, lockupStart),
        endSec: end,
        text: input.brandLockup.brand,
        style: "brand",
      });
      const claim = input.brandLockup.claim?.trim() || "";
      if (claim) {
        cues.push({
          startSec: Math.max(0, lockupStart),
          endSec: end,
          text: claim,
          style: "claim",
        });
      }
    }
    return cues;
  }
  const caption = captionTextForScene(input.scene);
  if (caption) {
    cues.push({
      startSec: 0,
      endSec: end,
      text: caption,
      style: "caption",
    });
  }
  return cues;
}

/**
 * Non-Hero: leave Mini tail unused.
 * Hero: take ≤4s settled pouch (tail by default), freeze-pad the rest of sceneDur.
 */
export function planSceneTake(
  sceneDur: number,
  mediaDur: number,
  opts: {
    isHeroClose?: boolean;
    heroWindow?: "tail" | "mid" | "head";
    heroExtraSec?: number;
  } = {},
): { ss: number; takeDur: number; savedSec: number; freezePadSec: number } {
  if (opts.isHeroClose) {
    const targetTimeline = Math.max(
      0.5,
      sceneDur + (opts.heroExtraSec ?? 0),
    );
    // Motion portion: short still pouch (≤4s); never pull the whole long Hero
    // timeline from Mini open (settle/cup) when Hero ≈ media length.
    const motionCap = Math.min(HERO_MOTION_MAX_SEC, targetTimeline, mediaDur);
    const takeDur = Math.max(0.5, motionCap);
    const window = opts.heroWindow ?? "tail";
    let ss = 0;
    if (mediaDur > takeDur + 0.05) {
      if (window === "tail") {
        ss = mediaDur - takeDur;
        // When skip would be tiny (<1s), force stronger open discard using ≤4s take.
        if (ss < HERO_MIN_SKIP_OPEN_SEC - 1e-6) {
          const forcedTake = Math.min(HERO_MOTION_MAX_SEC, targetTimeline, mediaDur);
          ss = Math.max(0, mediaDur - forcedTake);
        }
      } else if (window === "mid") {
        ss = Math.max(0, (mediaDur - takeDur) / 2);
      } else {
        ss = 0;
      }
    }
    const freezePadSec = Math.max(0, targetTimeline - takeDur);
    return { ss, takeDur, savedSec: 0, freezePadSec };
  }
  const usable = Math.max(0.5, mediaDur - MINI_TAIL_DISCARD_SEC);
  const takeDur = Math.min(sceneDur, usable);
  return {
    ss: 0,
    takeDur,
    savedSec: Math.max(0, sceneDur - takeDur),
    freezePadSec: 0,
  };
}

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function materializeLocal(
  url: string,
  dir: string,
  basename: string,
): Promise<string> {
  if (!isRemoteUrl(url)) {
    if (!existsSync(url)) {
      throw new Error(`composeAd local media missing: ${url}`);
    }
    return url;
  }
  const extMatch = url.split("?")[0]?.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch?.[1] ? `.${extMatch[1]}` : ".bin";
  const dest = join(dir, `${basename}${ext}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`composeAd download failed HTTP ${res.status}: ${url}`);
  }
  const nodeStream = Readable.fromWeb(
    res.body as import("node:stream/web").ReadableStream,
  );
  await pipeline(nodeStream, createWriteStream(dest));
  return dest;
}

/**
 * Mix VO + optional BGM/SFX. Always loudnorm VO to 48k stereo even without bed.
 */
function mixAudioBed(
  dir: string,
  voiceLocal: string,
  bgmPath: string | null,
  sfxCues: SfxCue[],
  durationSec: number,
): string {
  const outPath = join(dir, "mix.m4a");
  const args: string[] = ["-y", "-i", voiceLocal];
  let inputIdx = 1;
  let bgmIdx: number | null = null;
  if (bgmPath) {
    args.push("-stream_loop", "-1", "-i", bgmPath);
    bgmIdx = inputIdx;
    inputIdx += 1;
  }
  const sfxIdx: number[] = [];
  for (const cue of sfxCues) {
    args.push("-i", cue.filePath);
    sfxIdx.push(inputIdx);
    inputIdx += 1;
  }

  const dur = durationSec.toFixed(3);
  const fadeOutStart = Math.max(0, durationSec - 0.6).toFixed(3);
  const filters: string[] = [];
  // Pad VO to full mix length before amix so Hero tail keeps BGM
  // (amix duration=first previously truncated the bed to VO length).
  filters.push(
    `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${dur},atrim=0:${dur}[vo]`,
  );
  const mixInputs = ["[vo]"];
  if (bgmIdx !== null) {
    filters.push(
      `[${bgmIdx}:a]volume=0.18,aloop=loop=-1:size=2e+09,atrim=0:${dur},afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=0.6,aformat=sample_rates=48000:channel_layouts=stereo[bgm]`,
    );
    filters.push(`[bgm]volume=0.85[bgmd]`);
    mixInputs.push("[bgmd]");
  }
  for (const [i, cue] of sfxCues.entries()) {
    const idx = sfxIdx[i]!;
    const delayMs = Math.round(Math.max(0, cue.atSec) * 1000);
    filters.push(
      `[${idx}:a]volume=0.45,adelay=${delayMs}|${delayMs},aformat=sample_rates=48000:channel_layouts=stereo[sfx${i}]`,
    );
    mixInputs.push(`[sfx${i}]`);
  }

  if (mixInputs.length === 1) {
    filters.push(`[vo]anull[aout]`);
  } else {
    const n = mixInputs.length;
    // longest: BGM/SFX may outlive unpadded VO; VO is already padded to dur.
    filters.push(
      `${mixInputs.join("")}amix=inputs=${n}:duration=longest:dropout_transition=0:normalize=0[aout]`,
    );
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-t",
    String(durationSec),
    "-c:a",
    "aac",
    outPath,
  );

  const run = runFfmpeg(args);
  if (run.status !== 0 || !existsSync(outPath)) {
    // Fallback: at least try loudnorm solo.
    const solo = join(dir, "vo_loud.m4a");
    const soloRun = runFfmpeg([
      "-y",
      "-i",
      voiceLocal,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo",
      "-c:a",
      "aac",
      solo,
    ]);
    if (soloRun.status === 0 && existsSync(solo)) return solo;
    return voiceLocal;
  }
  return outPath;
}

type TakePlan = { ss: number; takeDur: number; freezePadSec: number };

function planAllTakes(
  input: ComposeAdInput,
  sceneLocals: string[],
  heroWindow: "tail" | "mid" | "head",
): { takePlans: TakePlan[]; heroExtraSec: number } {
  const takePlans: TakePlan[] = [];
  let heroExtraSec = 0;
  for (const [i, scene] of input.scenes.entries()) {
    const local = sceneLocals[i]!;
    const sceneSpec = input.adSpec.scenes.find((s) => s.id === scene.sceneId);
    const sceneDur = Math.max(
      0.5,
      sceneSpec ? sceneSpec.end - sceneSpec.start : 2,
    );
    const mediaDur = probeMediaDurationSec(local) ?? sceneDur;
    if (!sceneSpec?.isHeroClose) {
      const plan = planSceneTake(sceneDur, mediaDur, { isHeroClose: false });
      heroExtraSec += plan.savedSec;
      takePlans.push({
        ss: plan.ss,
        takeDur: plan.takeDur,
        freezePadSec: 0,
      });
    } else {
      takePlans.push({ ss: 0, takeDur: sceneDur, freezePadSec: 0 });
    }
  }
  for (const [i, scene] of input.scenes.entries()) {
    const sceneSpec = input.adSpec.scenes.find((s) => s.id === scene.sceneId);
    if (!sceneSpec?.isHeroClose) continue;
    const local = sceneLocals[i]!;
    const sceneDur = Math.max(0.5, sceneSpec.end - sceneSpec.start);
    const mediaDur = probeMediaDurationSec(local) ?? sceneDur;
    const plan = planSceneTake(sceneDur, mediaDur, {
      isHeroClose: true,
      heroWindow,
      heroExtraSec,
    });
    takePlans[i] = {
      ss: plan.ss,
      takeDur: plan.takeDur,
      freezePadSec: plan.freezePadSec,
    };
  }
  return { takePlans, heroExtraSec };
}

function normalizeOneScene(args: {
  dir: string;
  i: number;
  scene: GeneratedSceneMedia;
  sceneSpec: AdSpec["scenes"][number] | undefined;
  local: string;
  elementLocal: string | null;
  take: TakePlan;
  width: number;
  height: number;
  fontFile: string;
  brandLockup: ComposeAdInput["brandLockup"];
  normalizedOut: string;
}): void {
  const {
    dir,
    i,
    scene,
    sceneSpec,
    local,
    elementLocal,
    take,
    width,
    height,
    fontFile,
    brandLockup,
    normalizedOut,
  } = args;
  const isImage = /\.(jpe?g|png|webp|gif)$/i.test(local.split("?")[0] ?? "");
  const sceneKey = `s${String(i + 1).padStart(2, "0")}`;

  if (isImage && !scene.elementUrl) {
    throw new Error(
      `composeAd refuses static image scene ${scene.sceneId} — asset ≠ scene (need Mini video)`,
    );
  }

  const textVf = textOverlayFilters(
    sceneSpec,
    brandLockup,
    height,
    fontFile,
    dir,
    sceneKey,
  );

  const ssArgs =
    take.ss > 0.02 ? (["-ss", take.ss.toFixed(3)] as string[]) : [];

  let normArgs: string[];
  if (elementLocal) {
    if (/\.(jpe?g|webp)$/i.test(elementLocal) && !sceneSpec?.isHeroClose) {
      const vf = [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        "fps=24",
        "format=yuv420p",
        textVf,
      ]
        .filter(Boolean)
        .join(",");
      normArgs = [
        "-y",
        ...ssArgs,
        "-i",
        local,
        "-t",
        String(take.takeDur),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        normalizedOut,
      ];
    } else {
      const prim = scene.motionPrimitive ?? "scale_in";
      const overlayFilter = motionOverlayFilter(prim, width, height);
      const postText = textVf ? `;[vout]${textVf}[vfinal]` : "";
      const mapLabel = textVf ? "[vfinal]" : "[vout]";
      normArgs = [
        "-y",
        ...ssArgs,
        "-i",
        local,
        "-loop",
        "1",
        "-framerate",
        "24",
        "-i",
        elementLocal,
        "-t",
        String(take.takeDur),
        "-filter_complex",
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p[bg];${overlayFilter}${postText}`,
        "-map",
        mapLabel,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        normalizedOut,
      ];
    }
  } else {
    if (isImage) {
      throw new Error(
        `composeAd refuses image-loop for ${scene.sceneId} — asset ≠ scene`,
      );
    }
    const freezePad = take.freezePadSec ?? 0;
    const useFreeze = freezePad > 0.05;
    const vfParts = [
      useFreeze
        ? `trim=duration=${take.takeDur.toFixed(3)},setpts=PTS-STARTPTS`
        : null,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "fps=24",
      "format=yuv420p",
      useFreeze
        ? `tpad=stop_mode=clone:stop_duration=${freezePad.toFixed(3)}`
        : null,
      textVf,
    ].filter(Boolean);
    const outDur = useFreeze ? take.takeDur + freezePad : take.takeDur;
    normArgs = [
      "-y",
      ...ssArgs,
      "-i",
      local,
      "-vf",
      vfParts.join(","),
      "-t",
      outDur.toFixed(3),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      normalizedOut,
    ];
  }
  const normRun = runFfmpeg(normArgs);
  if (normRun.status !== 0 || !existsSync(normalizedOut)) {
    throw new Error(
      `ffmpeg normalize scene failed: ${(normRun.stderr || normRun.stdout || "").slice(0, 400)}`,
    );
  }
}

function concatAndMux(args: {
  dir: string;
  normPaths: string[];
  voiceLocal: string;
  input: ComposeAdInput;
  outPath: string;
  targetDurationSec?: number;
  reuseAudioIn?: string;
  reuseMixDur?: number;
}): { mixDur: number; audioIn: string; bgmUsed: boolean; sfxCount: number } {
  const {
    dir,
    normPaths,
    voiceLocal,
    input,
    outPath,
    targetDurationSec,
    reuseAudioIn,
    reuseMixDur,
  } = args;

  const sfxCues: SfxCue[] = [];
  for (const scene of input.adSpec.scenes) {
    const cue = pickSfxForAction(scene.action, scene.start);
    if (cue) sfxCues.push(cue);
  }

  const listPath = join(dir, "scenes.txt");
  const listBody = normPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(listPath, listBody, "utf8");

  const concatPath = join(dir, "concat.mp4");
  const concatRun = runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    concatPath,
  ]);
  if (concatRun.status !== 0 || !existsSync(concatPath)) {
    throw new Error(
      `ffmpeg concat failed: ${(concatRun.stderr || concatRun.stdout || "").slice(0, 400)}`,
    );
  }

  const mixDur =
    probeMediaDurationSec(concatPath) ??
    reuseMixDur ??
    (targetDurationSec ?? DEFAULT_TARGET_SEC);

  let audioIn = reuseAudioIn;
  let bgmUsed = false;
  if (!audioIn || !existsSync(audioIn) || Math.abs((reuseMixDur ?? mixDur) - mixDur) > 0.15) {
    const bgmPath = pickBgmTrack(input.adSpec.audioDirection?.musicMood);
    bgmUsed = Boolean(bgmPath);
    audioIn = mixAudioBed(dir, voiceLocal, bgmPath, sfxCues, mixDur);
    const audioDur = probeMediaDurationSec(audioIn) ?? 0;
    if (mixDur - audioDur >= 0.25) {
      const paddedAudio = join(dir, "audio_to_video.m4a");
      const aPad = runFfmpeg([
        "-y",
        "-i",
        audioIn,
        "-af",
        `apad=pad_dur=${(mixDur - audioDur).toFixed(3)}`,
        "-t",
        String(mixDur),
        "-c:a",
        "aac",
        paddedAudio,
      ]);
      if (aPad.status === 0 && existsSync(paddedAudio)) {
        audioIn = paddedAudio;
      }
    }
  } else {
    bgmUsed = true; // unknown; preserve prior bed
  }

  const muxRun = runFfmpeg([
    "-y",
    "-i",
    concatPath,
    "-i",
    audioIn,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0?",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-t",
    String(mixDur),
    outPath,
  ]);
  if (muxRun.status !== 0 || !existsSync(outPath)) {
    throw new Error(
      `ffmpeg mux failed: ${(muxRun.stderr || muxRun.stdout || "").slice(0, 400)}`,
    );
  }

  return {
    mixDur,
    audioIn,
    bgmUsed,
    sfxCount: sfxCues.length,
  };
}

/**
 * Compose final 9:16 ad. Product cutouts only — never rectangular original cards.
 * Hero window retries: pass reuseWorkspace to re-encode Hero `ss` only.
 */
export async function composeAd(
  input: ComposeAdInput,
  opts: ComposeAdOptions = {},
): Promise<ComposeAdResult> {
  if (opts.composeFn) {
    return opts.composeFn(input);
  }

  if (!hasFfmpeg()) {
    throw new Error(
      "ffmpeg not available — composeAd fail closed (inject composeFn in tests)",
    );
  }

  if (!input.scenes.length) {
    throw new Error("composeAd requires at least one scene media");
  }

  const started = Date.now();
  const heroWindow = opts.heroWindow ?? "tail";
  const reuse = opts.reuseWorkspace;

  // —— Hero-only path: change ss, re-encode Hero, concat+mux (no re-download) ——
  if (reuse) {
    const heroIdx = input.adSpec.scenes.findIndex((s) => s.isHeroClose);
    if (heroIdx < 0) {
      throw new Error("composeAd reuseWorkspace requires a Hero Close scene");
    }
    const { takePlans } = planAllTakes(
      input,
      reuse.sceneLocals,
      heroWindow,
    );
    const heroNorm = join(
      reuse.dir,
      `norm_${String(heroIdx + 1).padStart(2, "0")}.mp4`,
    );
    normalizeOneScene({
      dir: reuse.dir,
      i: heroIdx,
      scene: input.scenes[heroIdx]!,
      sceneSpec: input.adSpec.scenes[heroIdx],
      local: reuse.sceneLocals[heroIdx]!,
      elementLocal: reuse.elementLocals[heroIdx] ?? null,
      take: takePlans[heroIdx]!,
      width: reuse.width,
      height: reuse.height,
      fontFile: reuse.fontFile,
      brandLockup: input.brandLockup,
      normalizedOut: heroNorm,
    });
    const normPaths = reuse.normPaths.map((p, i) =>
      i === heroIdx ? heroNorm : p,
    );
    const outPath = opts.outputPath ?? join(reuse.dir, `ad-${heroWindow}.mp4`);
    const muxed = concatAndMux({
      dir: reuse.dir,
      normPaths,
      voiceLocal: reuse.voiceLocal,
      input,
      outPath,
      targetDurationSec: opts.targetDurationSec,
      reuseAudioIn: reuse.audioIn,
      reuseMixDur: reuse.mixDur,
    });

    const captionCues = buildComposeCaptionCues(
      input.adSpec,
      input.brandLockup,
    );
    let finalOut = outPath;
    if (captionCues.length > 0) {
      const assPath = writeAssFile(reuse.dir, `captions-${heroWindow}`, captionCues, {
        width: reuse.width,
        height: reuse.height,
      });
      const captioned = join(reuse.dir, `ad-${heroWindow}-captioned.mp4`);
      burnAssCaptions({
        inputPath: outPath,
        outputPath: captioned,
        assPath,
      });
      finalOut = captioned;
      if (opts.outputPath) {
        const { copyFileSync } = await import("node:fs");
        copyFileSync(captioned, opts.outputPath);
        finalOut = opts.outputPath;
      }
    }

    // Caption each shot for panels (uncaptioned norms stay on workspace).
    const captionedShotPaths: string[] = [];
    for (const [i, scene] of input.scenes.entries()) {
      const sceneSpec = input.adSpec.scenes.find((s) => s.id === scene.sceneId);
      const norm = normPaths[i]!;
      if (!sceneSpec) {
        captionedShotPaths.push(norm);
        continue;
      }
      const shotDur =
        probeMediaDurationSec(norm) ??
        Math.max(0.5, sceneSpec.end - sceneSpec.start);
      const shotCues = buildShotCaptionCues({
        scene: sceneSpec,
        durationSec: shotDur,
        brandLockup: input.brandLockup,
      });
      if (!shotCues.length) {
        captionedShotPaths.push(norm);
        continue;
      }
      const shotAss = writeAssFile(
        reuse.dir,
        `shot_cap_${heroWindow}_${String(i + 1).padStart(2, "0")}`,
        shotCues,
        { width: reuse.width, height: reuse.height },
      );
      const shotOut = join(
        reuse.dir,
        `norm_cap_${heroWindow}_${String(i + 1).padStart(2, "0")}.mp4`,
      );
      try {
        burnAssCaptions({
          inputPath: norm,
          outputPath: shotOut,
          assPath: shotAss,
        });
        captionedShotPaths.push(shotOut);
      } catch {
        captionedShotPaths.push(norm);
      }
    }

    const workspace: ComposeWorkspace = {
      ...reuse,
      normPaths,
      audioIn: muxed.audioIn,
      mixDur: muxed.mixDur,
    };
    return {
      composedUrl: finalOut,
      latencyMs: Date.now() - started,
      provider: "ffmpeg",
      model:
        reuse.quality === "preview"
          ? "concat-mux-9x16-720-hero-ss"
          : "concat-mux-9x16-hero-ss",
      width: reuse.width,
      height: reuse.height,
      finalDurationSec: probeMediaDurationSec(finalOut) ?? undefined,
      bgmUsed: muxed.bgmUsed,
      sfxCount: muxed.sfxCount,
      heroOnlyReencode: true,
      shotLocalPaths: captionedShotPaths,
      ...(opts.keepWorkspace !== false ? { workspace } : {}),
    };
  }

  // —— Full compose path ——
  const dir = mkdtempSync(join(tmpdir(), "adtrier-compose-"));
  const quality = opts.generationQuality ?? "production";
  const width = quality === "preview" ? PREVIEW_W : PROD_W;
  const height = quality === "preview" ? PREVIEW_H : PROD_H;
  const outPath = opts.outputPath ?? join(dir, "ad.mp4");
  const fontFile = findFont();

  const [voiceLocal, ...sceneLocals] = await Promise.all([
    materializeLocal(input.voiceoverUrl, dir, "voiceover"),
    ...input.scenes.map((scene, i) =>
      materializeLocal(
        scene.mediaUrl,
        dir,
        `scene_${String(i + 1).padStart(2, "0")}`,
      ),
    ),
  ]);
  const elementLocals = await Promise.all(
    input.scenes.map(async (scene, i) => {
      const sceneSpec = input.adSpec.scenes.find((s) => s.id === scene.sceneId);
      if (
        scene.elementUrl &&
        !sceneSpec?.isHeroClose &&
        (scene.treatment === "composite" || scene.motionPrimitive)
      ) {
        return materializeLocal(
          scene.elementUrl,
          dir,
          `elem_${String(i + 1).padStart(2, "0")}`,
        );
      }
      return null;
    }),
  );

  const { takePlans, heroExtraSec } = planAllTakes(
    input,
    sceneLocals,
    heroWindow,
  );

  const normPaths: string[] = [];
  for (const [i, scene] of input.scenes.entries()) {
    const normalized = join(dir, `norm_${String(i + 1).padStart(2, "0")}.mp4`);
    normalizeOneScene({
      dir,
      i,
      scene,
      sceneSpec: input.adSpec.scenes.find((s) => s.id === scene.sceneId),
      local: sceneLocals[i]!,
      elementLocal: elementLocals[i] ?? null,
      take: takePlans[i]!,
      width,
      height,
      fontFile,
      brandLockup: input.brandLockup,
      normalizedOut: normalized,
    });
    normPaths.push(normalized);
  }

  const muxed = concatAndMux({
    dir,
    normPaths,
    voiceLocal,
    input,
    outPath,
    targetDurationSec: opts.targetDurationSec,
  });

  // Burn ASS captions onto the assembled MP4 (ffmpeg-static has no drawtext).
  const captionCues = buildComposeCaptionCues(input.adSpec, input.brandLockup);
  let finalOut = outPath;
  if (captionCues.length > 0) {
    const assPath = writeAssFile(dir, "captions", captionCues, {
      width,
      height,
    });
    const captioned = join(dir, "ad-captioned.mp4");
    burnAssCaptions({
      inputPath: outPath,
      outputPath: captioned,
      assPath,
    });
    finalOut = captioned;
    if (opts.outputPath) {
      // Honor caller outputPath: copy captioned result over the requested path.
      const { copyFileSync } = await import("node:fs");
      copyFileSync(captioned, opts.outputPath);
      finalOut = opts.outputPath;
    }
  }

  // Per-shot clips also get their own burned captions (relative timeline).
  const captionedShotPaths: string[] = [];
  for (const [i, scene] of input.scenes.entries()) {
    const sceneSpec = input.adSpec.scenes.find((s) => s.id === scene.sceneId);
    const norm = normPaths[i]!;
    if (!sceneSpec) {
      captionedShotPaths.push(norm);
      continue;
    }
    const shotDur = probeMediaDurationSec(norm) ?? Math.max(0.5, sceneSpec.end - sceneSpec.start);
    const shotCues = buildShotCaptionCues({
      scene: sceneSpec,
      durationSec: shotDur,
      brandLockup: input.brandLockup,
    });
    if (!shotCues.length) {
      captionedShotPaths.push(norm);
      continue;
    }
    const shotAss = writeAssFile(
      dir,
      `shot_cap_${String(i + 1).padStart(2, "0")}`,
      shotCues,
      { width, height },
    );
    const shotOut = join(
      dir,
      `norm_cap_${String(i + 1).padStart(2, "0")}.mp4`,
    );
    try {
      burnAssCaptions({
        inputPath: norm,
        outputPath: shotOut,
        assPath: shotAss,
      });
      captionedShotPaths.push(shotOut);
    } catch {
      // Shot captions are best-effort — full video already captioned.
      captionedShotPaths.push(norm);
    }
  }

  const workspace: ComposeWorkspace | undefined = opts.keepWorkspace
    ? {
        dir,
        voiceLocal,
        sceneLocals,
        elementLocals,
        // Keep uncaptioned norms for Hero ss retries (full ASS burns after mux).
        normPaths,
        heroExtraSec,
        width,
        height,
        fontFile,
        quality,
        audioIn: muxed.audioIn,
        mixDur: muxed.mixDur,
      }
    : undefined;

  return {
    composedUrl: finalOut,
    latencyMs: Date.now() - started,
    provider: "ffmpeg",
    model: quality === "preview" ? "concat-mux-9x16-720" : "concat-mux-9x16",
    width,
    height,
    finalDurationSec: probeMediaDurationSec(finalOut) ?? undefined,
    bgmUsed: muxed.bgmUsed,
    sfxCount: muxed.sfxCount,
    shotLocalPaths: captionedShotPaths,
    ...(workspace ? { workspace } : {}),
  };
}
