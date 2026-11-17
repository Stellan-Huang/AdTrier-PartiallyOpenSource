/**
 * Thin Volcengine Ark multimodal embedding client.
 * Uses DOUBAO_EMBEDDING_VISION_API + ARK_EMBEDDING_MODEL — not chat runner.
 */
import { ARK_BASE_URL, getArkEmbeddingModelId } from "./volcengine-models";
import { mapPool } from "@/lib/ai/pool";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CONCURRENCY = 8;

export type EmbedTextsResult = {
  vectors: number[][];
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; totalTokens: number };
  error?: string;
};

type MultimodalEmbedResponse = {
  data?: { embedding?: number[] };
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string };
};

function requireEmbeddingApiKey(): string {
  const key = process.env.DOUBAO_EMBEDDING_VISION_API?.trim();
  if (!key) {
    throw new Error(
      "Missing DOUBAO_EMBEDDING_VISION_API for embeddings. Do not use chat SEED_* keys.",
    );
  }
  return key;
}

async function embedOne(
  text: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<{ vector: number[]; promptTokens: number; totalTokens: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ARK_BASE_URL}/embeddings/multimodal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{ type: "text", text }],
      }),
      signal: controller.signal,
    });
    const raw = (await res.json()) as MultimodalEmbedResponse;
    if (!res.ok) {
      throw new Error(
        raw.error?.message ||
          `Embedding HTTP ${res.status}: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }
    const vector = raw.data?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Embedding response missing data.embedding");
    }
    return {
      vector,
      promptTokens: raw.usage?.prompt_tokens ?? 0,
      totalTokens: raw.usage?.total_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed texts via Ark multimodal embeddings (vision embedding model, text-only input).
 * On any failure returns empty vectors + error (caller falls back — never forge vectors).
 */
export async function volcengineEmbedTexts(
  texts: string[],
  opts?: { concurrency?: number; timeoutMs?: number },
): Promise<EmbedTextsResult> {
  const started = Date.now();
  const model = getArkEmbeddingModelId();
  if (texts.length === 0) {
    return {
      vectors: [],
      model,
      latencyMs: 0,
      usage: { promptTokens: 0, totalTokens: 0 },
    };
  }

  try {
    const apiKey = requireEmbeddingApiKey();
    const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const parts = await mapPool(texts, concurrency, (text) =>
      embedOne(text, apiKey, model, timeoutMs),
    );
    return {
      vectors: parts.map((p) => p.vector),
      model,
      latencyMs: Date.now() - started,
      usage: {
        promptTokens: parts.reduce((s, p) => s + p.promptTokens, 0),
        totalTokens: parts.reduce((s, p) => s + p.totalTokens, 0),
      },
    };
  } catch (err) {
    return {
      vectors: [],
      model,
      latencyMs: Date.now() - started,
      usage: { promptTokens: 0, totalTokens: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
