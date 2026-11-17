import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AiCapabilityId } from "@/lib/ai/types";
import {
  DEFAULT_PROMPT_VERSION,
  getCapability,
  getPromptVersion,
  resolveModel,
} from "@/lib/ai/registry";

const CACHE_REL = join(".data", "understanding-cache");

/**
 * Local/dev: `{cwd}/.data/understanding-cache`.
 * Vercel/serverless: `/tmp/.data/understanding-cache` (`/var/task` is read-only).
 */
export function useTmpUnderstandingCache(): boolean {
  return (
    Boolean(process.env.VERCEL) ||
    process.env.UNDERSTANDING_CACHE_TO_TMP === "1" ||
    process.env.UNDERSTANDING_CACHE_TO_TMP === "true"
  );
}

export function getCacheDir(): string {
  if (useTmpUnderstandingCache()) {
    return join("/tmp", CACHE_REL);
  }
  return join(process.cwd(), CACHE_REL);
}

const STAGE_CAPABILITY: Record<string, AiCapabilityId> = {
  understandText: "understandText",
  understandImages: "understandImages",
  understandVideos: "understandVideo",
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Cache key uses THIS modality's capability promptVersion + model
 * (not always understandText).
 */
export function buildCacheKey(stage: string, payload: unknown): string {
  const capabilityId = STAGE_CAPABILITY[stage] ?? "understandText";
  const entry = getCapability(capabilityId);
  const material = [
    getPromptVersion(entry) || DEFAULT_PROMPT_VERSION,
    resolveModel(entry),
    stage,
    canonicalJson(payload),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function cachePath(key: string): string {
  return join(getCacheDir(), `${key}.json`);
}

export function readCache<T>(key: string): T | null {
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  const path = cachePath(key);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value), "utf8");
  } catch (err) {
    // Cache is best-effort — never fail PI because of a filesystem cache write.
    console.warn(
      "[understanding/cache] skip write",
      path,
      err instanceof Error ? err.message : err,
    );
  }
}
