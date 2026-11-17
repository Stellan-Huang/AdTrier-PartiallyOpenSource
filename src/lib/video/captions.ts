/**
 * Burn cinematic English captions via ASS + ffmpeg `subtitles` filter.
 *
 * johnvansickle ffmpeg-static has libass but NOT drawtext — so Preview/Final
 * must not rely on composeAd's drawtext path for VO captions.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasFfmpeg,
  runFfmpeg,
  summarizeFfmpegFailure,
} from "@/lib/media/ffmpeg";

export type CaptionCue = {
  startSec: number;
  endSec: number;
  text: string;
  /** Brand lockup sits top-center; default bottom caption. */
  style?: "caption" | "brand" | "claim";
};

/** Vendored DejaVu — kept outside `public/` so Turbopack won't trace all static assets. */
export function captionFontsDir(): string {
  return join(process.cwd(), "resources/captions-fonts");
}

export function captionFontFile(bold = false): string {
  const dir = captionFontsDir();
  const boldPath = join(dir, "DejaVuSans-Bold.ttf");
  const regular = join(dir, "DejaVuSans.ttf");
  if (bold && existsSync(/*turbopackIgnore: true*/ boldPath)) return boldPath;
  if (existsSync(/*turbopackIgnore: true*/ regular)) return regular;
  return "";
}

/**
 * Soft-wrap for cinematic captions — prefer ≤2 lines.
 * Returns real newlines; `buildAssDocument` converts them to ASS `\N` after escape.
 */
export function wrapCaptionLines(
  text: string,
  maxChars = 32,
  maxLines = 2,
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

/** ASS dialogue clock: H:MM:SS.cs (centiseconds). */
export function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const csClamped = cs >= 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(csClamped).padStart(2, "0")}`;
}

/**
 * Escape ASS dialogue specials. Call BEFORE inserting ASS tags like `\N`.
 * Doubling backslashes after wrapCaptionLines (`…\N…`) used to paint a literal
 * `\` on screen — wrap with real newlines, escape, then convert `\n` → `\N`.
 */
function escapeAssDialogue(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/**
 * Prefer scene voiceover for captions; fall back to on-screen text.
 * Soft-trim very long VO (~18 words) so cards stay readable.
 * Hero / product-hold uses brandLockup (Brand + product name) instead.
 */
export function captionTextForScene(scene: {
  voiceover?: string;
  text?: string;
  isHeroClose?: boolean;
}): string {
  if (scene.isHeroClose) return "";
  const vo = scene.voiceover?.trim() || "";
  const text = scene.text?.trim() || "";
  const raw = vo || text;
  if (!raw) return "";
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length <= 18) return raw;
  return words.slice(0, 18).join(" ");
}

export function buildAssDocument(input: {
  cues: CaptionCue[];
  playResX: number;
  playResY: number;
}): string {
  // ~2–3 ASS sizes larger than prior (1280p: 36 → 44). Divisor 36→29 ≈ +25%.
  const fontSize = Math.max(32, Math.round(input.playResY / 29));
  const brandSize = Math.max(38, Math.round(fontSize * 1.35));
  const claimSize = Math.max(28, Math.round(fontSize * 0.95));
  const marginV = Math.round(input.playResY * 0.1);
  const brandMargin = Math.round(input.playResY * 0.08);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${input.playResX}
PlayResY: ${input.playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,0,2,48,48,${marginV},1
Style: Brand,DejaVu Sans,${brandSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,0,8,48,48,${brandMargin},1
Style: Claim,DejaVu Sans,${claimSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,8,48,48,${brandMargin + Math.round(brandSize * 1.6)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = input.cues
    .filter((c) => c.text.trim() && c.endSec > c.startSec + 0.05)
    .map((c) => {
      const style =
        c.style === "brand" ? "Brand" : c.style === "claim" ? "Claim" : "Caption";
      const wrapped =
        c.style === "caption" || !c.style
          ? wrapCaptionLines(c.text)
          : wrapCaptionLines(c.text, c.style === "brand" ? 28 : 34, 2);
      // Escape each visual line, then join with ASS hard-break `\N`.
      const body = wrapped
        .split("\n")
        .map((line) => escapeAssDialogue(line))
        .join("\\N");
      return `Dialogue: 0,${formatAssTime(c.startSec)},${formatAssTime(c.endSec)},${style},,0,0,0,,${body}`;
    })
    .join("\n");

  return `${header}${events}\n`;
}

/** Escape a path for the ffmpeg `subtitles=` filter option. */
export function escapeSubtitlesFilterPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

/**
 * Burn ASS onto a local MP4 (re-encodes video, copies audio when present).
 * Throws on missing ffmpeg / fonts / failure.
 */
export function burnAssCaptions(input: {
  inputPath: string;
  outputPath: string;
  assPath: string;
  fontsDir?: string;
}): void {
  if (!hasFfmpeg()) {
    throw new Error("ffmpeg not available for captions");
  }
  if (!existsSync(/*turbopackIgnore: true*/ input.inputPath)) {
    throw new Error(`Caption input missing: ${input.inputPath}`);
  }
  if (!existsSync(/*turbopackIgnore: true*/ input.assPath)) {
    throw new Error(`ASS file missing: ${input.assPath}`);
  }
  const fontsDir = input.fontsDir || captionFontsDir();
  if (!existsSync(/*turbopackIgnore: true*/ fontsDir)) {
    throw new Error(`Caption fonts dir missing: ${fontsDir}`);
  }
  const assEsc = escapeSubtitlesFilterPath(input.assPath);
  const fontsEsc = escapeSubtitlesFilterPath(fontsDir);
  const vf = `subtitles=${assEsc}:fontsdir=${fontsEsc}`;
  const run = runFfmpeg([
    "-y",
    "-i",
    input.inputPath,
    "-vf",
    vf,
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
  if (run.status !== 0 || !existsSync(/*turbopackIgnore: true*/ input.outputPath)) {
    throw new Error(
      `ffmpeg captions failed: ${summarizeFfmpegFailure(
        String(run.stderr || ""),
        String(run.stdout || ""),
      )}`,
    );
  }
}

export function writeAssFile(
  dir: string,
  basename: string,
  cues: CaptionCue[],
  playRes: { width: number; height: number },
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${basename}.ass`);
  writeFileSync(
    path,
    buildAssDocument({
      cues,
      playResX: playRes.width,
      playResY: playRes.height,
    }),
    "utf8",
  );
  return path;
}
