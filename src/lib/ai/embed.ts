/**
 * Public embedding capability — thin wrapper over Volcengine multimodal embed.
 * Not part of runCapability / chat AiRunner.
 */
import {
  volcengineEmbedTexts,
  type EmbedTextsResult,
} from "./providers/volcengine-embed";

export type { EmbedTextsResult };

export type EmbedTextsOptions = {
  concurrency?: number;
  timeoutMs?: number;
  /** Test injection — bypass network. */
  embedFn?: (texts: string[]) => Promise<EmbedTextsResult>;
};

export async function embedTexts(
  texts: string[],
  opts: EmbedTextsOptions = {},
): Promise<EmbedTextsResult> {
  if (opts.embedFn) {
    return opts.embedFn(texts);
  }
  return volcengineEmbedTexts(texts, {
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
  });
}

/** Cosine similarity; returns 0 for zero-length or mismatched vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
