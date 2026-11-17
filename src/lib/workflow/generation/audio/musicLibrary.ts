/**
 * Local BGM library — mood → track path.
 * Missing files = silent OK (never blocks video).
 *
 * Temporary kill-switch: COMPOSE_BGM=0|false|off skips BGM mix (VO-only).
 * Re-enable: unset COMPOSE_BGM, or set COMPOSE_BGM=1|true|on.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const BGM_ROOT = join(process.cwd(), "public/audio/bgm");

/** Mood keywords → preferred basename (without extension). */
const MOOD_MAP: Array<{ match: RegExp; file: string }> = [
  { match: /warm|soft|gentle|calm|cozy/i, file: "warm-ambient" },
  { match: /bright|fresh|upbeat|energetic|spark/i, file: "bright-pulse" },
  { match: /cinematic|epic|dramatic|tension/i, file: "cinematic-soft" },
  { match: /playful|fun|light/i, file: "playful-pluck" },
];

const EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a"] as const;

/**
 * Whether compose should mix BGM under VO.
 * Default: enabled. Disable with COMPOSE_BGM=0|false|off.
 */
export function isComposeBgmEnabled(): boolean {
  const raw = (process.env.COMPOSE_BGM || "").toLowerCase().trim();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

function resolveTrack(basename: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = join(BGM_ROOT, `${basename}${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Pick a BGM file for musicMood. Returns null when BGM disabled,
 * library empty, or no match.
 */
export function pickBgmTrack(musicMood?: string): string | null {
  if (!isComposeBgmEnabled()) return null;
  const mood = (musicMood ?? "").trim();
  if (mood) {
    for (const entry of MOOD_MAP) {
      if (entry.match.test(mood)) {
        const hit = resolveTrack(entry.file);
        if (hit) return hit;
      }
    }
  }
  // Fallback: first available default track if any.
  return resolveTrack("default") ?? resolveTrack("warm-ambient");
}

export function bgmLibraryRoot(): string {
  return BGM_ROOT;
}
