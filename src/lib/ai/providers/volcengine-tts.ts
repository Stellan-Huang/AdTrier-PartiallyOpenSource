/**
 * Thin Volcengine Seed TTS 2.0 adapter — not part of runCapability / chat registry.
 *
 * Product path (one-shot VO): OpenSpeech WebSocket unidirectional stream
 *   wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream
 * Auth (new console): X-Api-Key = SEED_TTS_2_0_API + X-Api-Resource-Id=seed-tts-2.0
 * Auth (legacy): X-Api-App-Id + X-Api-Access-Key (SEED_TTS_APP_ID / SEED_TTS_ACCESS_KEY)
 *
 * Binary frames: FullClientRequest (NoSeq) → AudioOnlyServer chunks → SessionFinished.
 * Falls back to HTTP unidirectional if WS fails (env TTS_TRANSPORT=http forces HTTP).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveAudioDurationSec } from "@/lib/media/ffmpeg";
import {
  describeMessage,
  EventType,
  marshalFullClientRequest,
  MsgType,
  unmarshalMessage,
} from "./volcengine-tts-protocol";

export type TtsSynthesizeResult = {
  audioUrl: string;
  durationSec: number;
  model: string;
  latencyMs: number;
  /** Transport used for this call. */
  transport?: "websocket" | "http";
};

export type TtsSynthesizeOptions = {
  /** Test injection — bypass network. */
  synthesizeFn?: (
    text: string,
    opts?: { voice?: string },
  ) => Promise<TtsSynthesizeResult>;
  voice?: string;
  timeoutMs?: number;
  /**
   * OpenSpeech speech_rate when supported (slight forward momentum).
   * Prefer env TTS_AD_SPEECH_RATE; only pass documented audio_params fields.
   */
  speechRate?: number;
  /** Optional speaking instruction / style hint (mapped to additions only). */
  voiceStyle?: string;
};

const OPENSPEECH_WS_URL =
  "wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream";
const OPENSPEECH_HTTP_URL =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_RESOURCE = "seed-tts-2.0";
const DEFAULT_VOICE = "zh_female_vv_uranus_bigtts";
const DEFAULT_TIMEOUT_MS = 120_000;

function requireTtsAuthHeaders(): Record<string, string> {
  const resource =
    process.env.ARK_TTS_RESOURCE_ID?.trim() ||
    process.env.ARK_TTS_MODEL?.trim() ||
    DEFAULT_RESOURCE;
  const appId = process.env.SEED_TTS_APP_ID?.trim();
  const accessKey = process.env.SEED_TTS_ACCESS_KEY?.trim();
  const apiKey = process.env.SEED_TTS_2_0_API?.trim();

  if (appId && accessKey) {
    return {
      "X-Api-App-Id": appId,
      "X-Api-Access-Key": accessKey,
      "X-Api-Resource-Id": resource,
    };
  }

  if (!apiKey) {
    throw new Error(
      "Missing SEED_TTS_2_0_API (OpenSpeech X-Api-Key) for TTS. " +
        "Do not use chat SEED_* Ark keys — speech console key required.",
    );
  }

  if (apiKey.startsWith("ark-")) {
    throw new Error(
      "SEED_TTS_2_0_API looks like an Ark Bearer key (ark-…). " +
        "Seed TTS 2.0 needs an OpenSpeech API Key from 语音技术 console " +
        "(X-Api-Key), or SEED_TTS_APP_ID + SEED_TTS_ACCESS_KEY.",
    );
  }

  return {
    "X-Api-Key": apiKey,
    "X-Api-Resource-Id": resource,
  };
}

function bufferFromWsData(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") {
    throw new Error(`Unexpected text WebSocket frame: ${data.slice(0, 200)}`);
  }
  throw new Error(`Unexpected WebSocket data type: ${typeof data}`);
}

function buildReqParams(
  text: string,
  voice: string,
  opts: TtsSynthesizeOptions,
): Record<string, unknown> {
  const audioParams: Record<string, unknown> = {
    format: "mp3",
    sample_rate: 24000,
  };
  const rateEnv = process.env.TTS_AD_SPEECH_RATE?.trim();
  const rate =
    opts.speechRate ??
    (rateEnv ? Number.parseFloat(rateEnv) : undefined);
  if (typeof rate === "number" && Number.isFinite(rate) && rate !== 0) {
    // Documented OpenSpeech audio_params field (int32 relative; +faster / −slower).
    audioParams.speech_rate = Math.trunc(rate);
  }

  const req: Record<string, unknown> = {
    text,
    speaker: voice,
    audio_params: audioParams,
  };

  // Map voiceStyle only into additions (no invented top-level fields).
  const style = opts.voiceStyle?.trim();
  if (style) {
    req.additions = JSON.stringify({
      explicit_language: "en",
      // Soft style hint — ignored safely if unsupported.
      style,
    });
  }

  return req;
}

async function collectOpenSpeechAudioWs(
  text: string,
  voice: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  opts: TtsSynthesizeOptions,
): Promise<{ bytes: Buffer; durationHintSec?: number }> {
  const requestId = randomUUID();
  const headers: Record<string, string> = {
    ...authHeaders,
    "X-Api-Request-Id": requestId,
    "X-Control-Require-Usage-Tokens-Return": "*",
  };

  const body = JSON.stringify({
    user: { uid: "adtrier-generateAd" },
    req_params: buildReqParams(text, voice, opts),
  });

  return await new Promise((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let durationHintSec: number | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      settle(() =>
        reject(new Error(`TTS WebSocket timed out after ${timeoutMs}ms`)),
      );
    }, timeoutMs);

    const ws = new WebSocket(OPENSPEECH_WS_URL, {
      // @ts-expect-error Node WebSocket client options include headers
      headers,
      maxPayload: 10 * 1024 * 1024,
    });
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      try {
        ws.send(marshalFullClientRequest(body));
      } catch (err) {
        settle(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      }
    });

    ws.addEventListener("message", (ev) => {
      try {
        const raw = bufferFromWsData(ev.data);
        const msg = unmarshalMessage(raw);

        if (msg.type === MsgType.Error) {
          settle(() =>
            reject(new Error(`TTS conversion failed: ${describeMessage(msg)}`)),
          );
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }

        if (
          msg.type === MsgType.FullServerResponse &&
          msg.event === EventType.SessionFailed
        ) {
          settle(() =>
            reject(
              new Error(
                `TTS SessionFailed: ${msg.payload.toString("utf8").slice(0, 300)}`,
              ),
            ),
          );
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }

        if (
          msg.type === MsgType.FullServerResponse &&
          msg.event === EventType.SessionFinished
        ) {
          try {
            const usage = JSON.parse(msg.payload.toString("utf8") || "{}") as {
              usage?: { duration?: number };
              duration?: number;
            };
            const d = usage.usage?.duration ?? usage.duration;
            if (typeof d === "number" && d > 0) {
              durationHintSec = d > 1000 ? d / 1000 : d;
            }
          } catch {
            // ignore
          }

          if (!chunks.length) {
            settle(() => reject(new Error("TTS returned no audio bytes")));
          } else {
            settle(() =>
              resolve({
                bytes: Buffer.concat(chunks),
                durationHintSec,
              }),
            );
          }
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }

        if (msg.type === MsgType.AudioOnlyServer && msg.payload.length > 0) {
          chunks.push(msg.payload);
        }
      } catch (err) {
        settle(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    });

    ws.addEventListener("error", () => {
      settle(() => reject(new Error("TTS WebSocket connection error")));
    });

    ws.addEventListener("close", () => {
      if (settled) return;
      if (chunks.length) {
        settle(() =>
          resolve({ bytes: Buffer.concat(chunks), durationHintSec }),
        );
      } else {
        settle(() =>
          reject(new Error("TTS WebSocket closed before SessionFinished")),
        );
      }
    });
  });
}

async function collectOpenSpeechAudioHttp(
  text: string,
  voice: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  opts: TtsSynthesizeOptions,
): Promise<{ bytes: Buffer; durationHintSec?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENSPEECH_HTTP_URL, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "X-Api-Request-Id": randomUUID(),
      },
      body: JSON.stringify({
        user: { uid: "adtrier-generateAd" },
        req_params: buildReqParams(text, voice, opts),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `TTS HTTP ${res.status}: ${errBody.slice(0, 300) || res.statusText}`,
      );
    }

    const rawText = await res.text();
    const chunks: Buffer[] = [];
    let durationHintSec: number | undefined;
    let lastCode: number | undefined;
    let lastMsg = "";

    for (const line of rawText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: {
        code?: number;
        message?: string;
        data?: string;
        duration?: number;
        sentence?: { duration?: number };
      };
      try {
        obj = JSON.parse(trimmed) as typeof obj;
      } catch {
        continue;
      }
      if (typeof obj.code === "number") lastCode = obj.code;
      if (obj.message) lastMsg = obj.message;
      if (obj.data && (obj.code === 0 || obj.code === undefined)) {
        chunks.push(Buffer.from(obj.data, "base64"));
      }
      const d = obj.duration ?? obj.sentence?.duration;
      if (typeof d === "number" && d > 0) {
        durationHintSec = d > 1000 ? d / 1000 : d;
      }
    }

    if (!chunks.length) {
      throw new Error(
        `TTS returned no audio bytes (code=${lastCode ?? "?"} msg=${lastMsg || "none"})`,
      );
    }
    return { bytes: Buffer.concat(chunks), durationHintSec };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesize spoken VO → local audio file path + duration.
 * Prefer WebSocket unidirectional stream; HTTP fallback unless TTS_TRANSPORT=http.
 */
export async function synthesizeSpeech(
  text: string,
  opts: TtsSynthesizeOptions = {},
): Promise<TtsSynthesizeResult> {
  if (opts.synthesizeFn) {
    return opts.synthesizeFn(text, { voice: opts.voice });
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const voice = opts.voice ?? DEFAULT_VOICE;
  const started = Date.now();
  const headers = requireTtsAuthHeaders();
  const forceHttp = process.env.TTS_TRANSPORT?.trim()?.toLowerCase() === "http";

  let bytes: Buffer;
  let durationHintSec: number | undefined;
  let transport: "websocket" | "http" = "websocket";

  if (forceHttp) {
    transport = "http";
    ({ bytes, durationHintSec } = await collectOpenSpeechAudioHttp(
      text,
      voice,
      headers,
      timeoutMs,
      opts,
    ));
  } else {
    try {
      ({ bytes, durationHintSec } = await collectOpenSpeechAudioWs(
        text,
        voice,
        headers,
        timeoutMs,
        opts,
      ));
    } catch (wsErr) {
      // Prefer WS; fall back to single HTTP whole-script call.
      transport = "http";
      try {
        ({ bytes, durationHintSec } = await collectOpenSpeechAudioHttp(
          text,
          voice,
          headers,
          timeoutMs,
          opts,
        ));
      } catch (httpErr) {
        throw new Error(
          `TTS WS failed (${wsErr instanceof Error ? wsErr.message : String(wsErr)}); ` +
            `HTTP fallback failed (${httpErr instanceof Error ? httpErr.message : String(httpErr)})`,
        );
      }
    }
  }

  const dir = join(tmpdir(), "adtrier-tts");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `vo-${randomUUID()}.mp3`);
  writeFileSync(outPath, bytes);

  // API metadata → bundled/system ffmpeg probe → MP3 header estimate.
  const durationSec = resolveAudioDurationSec({
    filePath: outPath,
    bytes,
    apiHintSec: durationHintSec,
  });

  return {
    audioUrl: outPath,
    durationSec,
    model: process.env.ARK_TTS_RESOURCE_ID?.trim() || DEFAULT_RESOURCE,
    latencyMs: Date.now() - started,
    transport,
  };
}
