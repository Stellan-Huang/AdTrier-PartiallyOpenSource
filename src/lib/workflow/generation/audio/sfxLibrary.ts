/**
 * Local SFX library — action keywords → one-shot.
 * Missing files = silent OK (never blocks video).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const SFX_ROOT = join(process.cwd(), "public/audio/sfx");

const KEYWORD_MAP: Array<{ match: RegExp; file: string }> = [
  { match: /whoosh|swipe|sweep|rush/i, file: "whoosh" },
  { match: /splash|pour|liquid|steam|sip/i, file: "splash" },
  { match: /pop|snap|click|reveal/i, file: "pop" },
  { match: /chime|sparkle|shine|glow/i, file: "chime" },
];

const EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a"] as const;

function resolveSfx(basename: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = join(SFX_ROOT, `${basename}${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

export type SfxCue = {
  filePath: string;
  /** Offset into the ad timeline (seconds). */
  atSec: number;
};

/**
 * Map scene action text → optional SFX cue at scene start.
 */
export function pickSfxForAction(
  action: string,
  atSec: number,
): SfxCue | null {
  const text = action.trim();
  if (!text) return null;
  for (const entry of KEYWORD_MAP) {
    if (entry.match.test(text)) {
      const filePath = resolveSfx(entry.file);
      if (filePath) return { filePath, atSec };
    }
  }
  return null;
}

export function sfxLibraryRoot(): string {
  return SFX_ROOT;
}
