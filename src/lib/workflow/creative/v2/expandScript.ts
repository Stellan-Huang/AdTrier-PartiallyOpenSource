/**
 * V2: expandScript — ONE call expands up to SELECTED_CREATIVE_COUNT creatives.
 * VO preferred 24–30; hard fail outside ~22–34 (retry once on hard band);
 * soft warn outside preferred but inside hard band (keep). shots[] 1–2; VD+AD+entry/exit.
 */
import type { AiRunner } from "@/lib/ai";
import { makeFailedUsage, runCapability } from "@/lib/ai";
import {
  makeStageProvenance,
  newRunId,
  stableInputHash,
  type StageResult,
} from "@/lib/workflow/types";
import type { CreativeBrief } from "../types";
import {
  EXPAND_SCRIPT_SYSTEM,
  EXPAND_SCRIPT_USER_PREFIX,
  expandScriptResponseSchema,
} from "./prompts/expand-script";
import {
  CREATIVE_V2_STAGE_VERSION,
  VO_WORD_MAX,
  VO_WORD_MIN,
  VO_WORD_SOFT_MAX,
  VO_WORD_SOFT_MIN,
  type AudioDirection,
  type Creative,
  type CreativeLineageOpts,
  type ExpandScriptInput,
  type ExpandScriptOutput,
  type Script,
  type ScriptBeat,
  type ScriptShot,
  type ScriptShotProductRole,
  type ScriptShotTreatment,
  type VisualDirection,
} from "./types";

const PRODUCT_ROLES = new Set<ScriptShotProductRole>([
  "none",
  "reference",
  "element",
  "hero",
]);
const TREATMENTS = new Set<ScriptShotTreatment>([
  "generate",
  "animate",
  "composite",
]);

function isCalloutAssetId(assetId: string, brief: CreativeBrief): boolean {
  const img = brief.assets.images.find((i) => i.assetId === assetId);
  if (!img) return false;
  const roles = img.possibleAssetRoles.map((r) => r.toLowerCase());
  if (roles.some((r) => r === "hero" || r === "packshot")) return false;
  const roleHit = roles.some((r) =>
    ["ingredient", "detail", "ugc", "other"].includes(r),
  );
  const veBlob = JSON.stringify(img.visualElements ?? []).toLowerCase();
  const callout =
    /callout|annotation|infographic|labeled/.test(veBlob) ||
    (img.visualElements ?? []).some(
      (el) =>
        /callout|annotation|text/i.test(el.type) ||
        /callout|annotation|labeled/i.test(el.description),
    );
  return roleHit && callout;
}

function sanitizeShot(
  raw: unknown,
  warnings: string[],
  shotLabel: string,
  assetIds: Set<string>,
  brief: CreativeBrief,
): ScriptShot | null {
  if (!raw || typeof raw !== "object") {
    warnings.push(`${shotLabel}: missing shot — dropped`);
    return null;
  }
  const s = raw as Record<string, unknown>;
  const intent = typeof s.intent === "string" ? s.intent.trim() : "";
  const action = typeof s.action === "string" ? s.action.trim() : "";
  if (!intent) {
    warnings.push(`${shotLabel}: empty intent — dropped`);
    return null;
  }
  if (!action) {
    warnings.push(`${shotLabel}: empty action — dropped`);
    return null;
  }
  let productRole = String(s.productRole ?? "") as ScriptShotProductRole;
  if (!PRODUCT_ROLES.has(productRole)) {
    warnings.push(`${shotLabel}: invalid productRole — dropped`);
    return null;
  }
  const treatment = String(s.treatment ?? "") as ScriptShotTreatment;
  if (!TREATMENTS.has(treatment)) {
    warnings.push(`${shotLabel}: invalid treatment — dropped`);
    return null;
  }
  const rawIds = Array.isArray(s.assetIds) ? s.assetIds : [];
  let knownAssetIds = rawIds
    .filter((id): id is string => typeof id === "string")
    .filter((id) => assetIds.has(id));
  if (rawIds.some((id) => typeof id === "string" && !assetIds.has(id))) {
    warnings.push(`${shotLabel}: stripped unknown assetIds`);
  }
  // Callout/annotation assets cannot feed Seedance product reference at all.
  if (productRole !== "none") {
    const before = knownAssetIds.length;
    knownAssetIds = knownAssetIds.filter(
      (id) => !isCalloutAssetId(id, brief),
    );
    if (knownAssetIds.length < before) {
      warnings.push(
        `${shotLabel}: stripped callout/annotation assets from ${productRole}`,
      );
    }
    if (knownAssetIds.length === 0 && before > 0) {
      // Replace with a packshot/hero asset — never keep callout as reference.
      const packshot = [...brief.assets.images]
        .filter((img) => !isCalloutAssetId(img.assetId, brief))
        .sort((a, b) => {
          const score = (img: (typeof brief.assets.images)[number]) => {
            const roles = img.possibleAssetRoles.map((r) => r.toLowerCase());
            if (roles.includes("hero")) return 0;
            if (roles.includes("packshot")) return 1;
            return 2;
          };
          return score(a) - score(b) || a.assetId.localeCompare(b.assetId);
        })[0];
      if (packshot && assetIds.has(packshot.assetId)) {
        knownAssetIds = [packshot.assetId];
        warnings.push(
          `${shotLabel}: replaced callout-only assets with packshot ${packshot.assetId}`,
        );
      } else {
        warnings.push(
          `${shotLabel}: callout-only assets and no packshot fallback — dropped`,
        );
        return null;
      }
    }
  }
  if (productRole !== "none" && knownAssetIds.length === 0) {
    warnings.push(
      `${shotLabel}: productRole=${productRole} needs known assetIds — dropped`,
    );
    return null;
  }
  if (productRole === "none" && treatment !== "generate") {
    warnings.push(
      `${shotLabel}: productRole=none requires treatment=generate — coerced`,
    );
  }
  const entry =
    typeof s.entry === "string" && s.entry.trim() ? s.entry.trim() : undefined;
  const exit =
    typeof s.exit === "string" && s.exit.trim() ? s.exit.trim() : undefined;
  return {
    intent,
    action,
    assetIds: knownAssetIds,
    productRole,
    treatment: productRole === "none" ? "generate" : treatment,
    ...(entry ? { entry } : {}),
    ...(exit ? { exit } : {}),
  };
}

function sanitizeVisualDirection(
  raw: unknown,
  warnings: string[],
  label: string,
): VisualDirection | undefined {
  if (!raw || typeof raw !== "object") {
    warnings.push(`${label}: missing visualDirection`);
    return undefined;
  }
  const v = raw as Record<string, unknown>;
  const world = typeof v.world === "string" ? v.world.trim() : "";
  const palette = typeof v.palette === "string" ? v.palette.trim() : "";
  const lighting = typeof v.lighting === "string" ? v.lighting.trim() : "";
  const cameraEnergy =
    typeof v.cameraEnergy === "string" ? v.cameraEnergy.trim() : "";
  if (!world || !palette || !lighting || !cameraEnergy) {
    warnings.push(`${label}: incomplete visualDirection`);
    return undefined;
  }
  return { world, palette, lighting, cameraEnergy };
}

function sanitizeAudioDirection(
  raw: unknown,
  warnings: string[],
  label: string,
): AudioDirection | undefined {
  if (!raw || typeof raw !== "object") {
    warnings.push(`${label}: missing audioDirection`);
    return undefined;
  }
  const a = raw as Record<string, unknown>;
  const voiceStyle =
    typeof a.voiceStyle === "string" ? a.voiceStyle.trim() : "";
  const musicMood = typeof a.musicMood === "string" ? a.musicMood.trim() : "";
  if (!voiceStyle || !musicMood) {
    warnings.push(`${label}: incomplete audioDirection`);
    return undefined;
  }
  return { voiceStyle, musicMood };
}

function sanitizeShots(
  raw: unknown,
  warnings: string[],
  beatLabel: string,
  assetIds: Set<string>,
  brief: CreativeBrief,
): ScriptShot[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    warnings.push(`${beatLabel}: missing shots — beat dropped`);
    return [];
  }
  const shots: ScriptShot[] = [];
  for (const [si, item] of raw.entries()) {
    if (shots.length >= 2) {
      warnings.push(`${beatLabel}: trimmed shots beyond 2`);
      break;
    }
    const shot = sanitizeShot(
      item,
      warnings,
      `${beatLabel} shot[${si}]`,
      assetIds,
      brief,
    );
    if (shot) shots.push(shot);
  }
  if (shots.length === 0) {
    warnings.push(`${beatLabel}: no valid shots — beat dropped`);
  }
  return shots;
}

export type ExpandScriptOptions = CreativeLineageOpts & {
  /** Optional max VO words hint appended to the expand payload (TTS overrun rewrite). */
  maxVoWords?: number;
  /** Optional min VO words hint (TTS underrun rewrite — avoid long silent Hero). */
  minVoWords?: number;
  runner?: AiRunner;
};

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function scriptVoWordCount(script: Script): number {
  return script.beats.reduce(
    (n, b) => n + countWords(b.voiceover ?? ""),
    0,
  );
}

function briefFactIds(brief: CreativeBrief): Set<string> {
  return new Set(brief.facts.map((f) => f.id));
}

function briefAssetIds(brief: CreativeBrief): Set<string> {
  return new Set([
    ...brief.assets.images.map((i) => i.assetId),
    ...brief.assets.videos.map((v) => v.assetId),
  ]);
}

function sanitizeScripts(
  raw: { scripts?: Script[] },
  selected: Creative[],
  brief: CreativeBrief,
): { scripts: Script[]; warnings: string[]; hardVoFail: boolean } {
  const warnings: string[] = [];
  let hardVoFail = false;
  const factIds = briefFactIds(brief);
  const assetIds = briefAssetIds(brief);
  const selectedIds = new Set(selected.map((c) => c.id));
  const scripts: Script[] = [];

  for (const [i, s] of (raw.scripts ?? []).entries()) {
    if (!s || typeof s.creativeId !== "string") {
      warnings.push(`Dropped script[${i}] missing creativeId`);
      continue;
    }
    if (!selectedIds.has(s.creativeId)) {
      warnings.push(`Dropped script for unknown creativeId ${s.creativeId}`);
      continue;
    }

    const beats: ScriptBeat[] = [];
    for (const [bi, b] of (s.beats ?? []).entries()) {
      if (
        !b ||
        typeof b.purpose !== "string" ||
        b.purpose.trim().length < 1 ||
        typeof b.voiceover !== "string"
      ) {
        continue;
      }
      const beatLabel = `Script ${s.creativeId} beat[${bi}]`;
      const voText = String(b.voiceover).trim();
      const beatWords = countWords(voText);
      if (beatWords > 0 && beatWords < 5 && beatWords !== 1) {
        // Allow single-word punchline; warn on 2–4 word fragments.
        warnings.push(
          `${beatLabel}: voiceover has ${beatWords} words (<5) — soft warning`,
        );
      }
      const shots = sanitizeShots(
        (b as ScriptBeat & { shots?: unknown }).shots,
        warnings,
        beatLabel,
        assetIds,
        brief,
      );
      if (shots.length === 0) continue;

      const beatAssetIds = [
        ...new Set(shots.flatMap((sh) => sh.assetIds)),
      ];

      beats.push({
        purpose: String(b.purpose).trim(),
        voiceover: voText,
        ...(b.text ? { text: String(b.text).trim() } : {}),
        factIds: (b.factIds ?? []).filter((id) => factIds.has(id)),
        assetIds: beatAssetIds,
        shots,
      });
    }

    if (beats.length < 3) {
      warnings.push(
        `Script for ${s.creativeId} has <3 valid beats — validation failed`,
      );
      continue;
    }

    if (beats.length > 6) {
      warnings.push(
        `Script for ${s.creativeId} has >6 beats — validation failed`,
      );
      continue;
    }

    const totalShots = beats.reduce((n, b) => n + b.shots.length, 0);
    if (totalShots < 4 || totalShots > 8) {
      warnings.push(
        `Script for ${s.creativeId} has ${totalShots} shots (soft guidance 4–8) — kept`,
      );
    }

    const scriptLabel = `Script ${s.creativeId}`;
    const visualDirection = sanitizeVisualDirection(
      (s as Script & { visualDirection?: unknown }).visualDirection,
      warnings,
      scriptLabel,
    );
    const audioDirection = sanitizeAudioDirection(
      (s as Script & { audioDirection?: unknown }).audioDirection,
      warnings,
      scriptLabel,
    );
    if (!visualDirection || !audioDirection) {
      warnings.push(
        `Script for ${s.creativeId} missing VisualDirection/AudioDirection — validation failed`,
      );
      continue;
    }

    const script: Script = {
      id:
        typeof s.id === "string" && s.id.trim()
          ? s.id.trim()
          : `script_${String(i + 1).padStart(2, "0")}`,
      creativeId: s.creativeId,
      visualDirection,
      audioDirection,
      beats,
    };

    const words = scriptVoWordCount(script);
    if (words < VO_WORD_SOFT_MIN || words > VO_WORD_SOFT_MAX) {
      warnings.push(
        `Script ${script.id} VO word count ${words} outside hard band ${VO_WORD_SOFT_MIN}–${VO_WORD_SOFT_MAX} — fail closed (kept with warning, not forged)`,
      );
      hardVoFail = true;
    } else if (words < VO_WORD_MIN || words > VO_WORD_MAX) {
      warnings.push(
        `Script ${script.id} VO word count ${words} outside preferred ${VO_WORD_MIN}–${VO_WORD_MAX} — soft warning (kept)`,
      );
    }

    scripts.push(script);
  }

  return { scripts, warnings, hardVoFail };
}

export async function expandScript(
  input: ExpandScriptInput,
  opts: ExpandScriptOptions = {},
): Promise<StageResult<ExpandScriptOutput>> {
  const nowIso = new Date().toISOString();
  const runId = opts.runId ?? newRunId();
  const inputHash = opts.inputHash ?? stableInputHash(input.brief);
  const provenance = makeStageProvenance(CREATIVE_V2_STAGE_VERSION, {
    runId,
    inputHash,
    generatedAt: nowIso,
  });

  if (!input.selected.length) {
    return {
      status: "failed",
      data: null,
      execution: {
        calls: [],
        errors: [
          {
            capability: "expandScript",
            errorType: "validation",
            errorMessage: "No selected creatives to expand",
          },
        ],
      },
      provenance,
    };
  }

  const payload = {
    brief: input.brief,
    selected: input.selected,
    ...(typeof opts.maxVoWords === "number" && opts.maxVoWords > 0
      ? {
          maxVoWords: opts.maxVoWords,
          voRewriteHints:
            "≤ 4 sentences; avoid colons, em-dashes and 3-adjective lists; keep measured TTS ≤ ~13s",
        }
      : {}),
    ...(typeof opts.minVoWords === "number" && opts.minVoWords > 0
      ? {
          minVoWords: opts.minVoWords,
          voLengthenHints:
            "Lengthen spoken VO to ≥ ~11.5s measured TTS (~28–32 words); still ≤ 4 sentences; no filler lists; keep measured TTS ≤ ~13.1s",
        }
      : {}),
  };
  const contents = `${EXPAND_SCRIPT_USER_PREFIX}\n\n${JSON.stringify(payload)}`;

  try {
    const runExpand = () =>
      runCapability<{ scripts: Script[] }>(
        "expandScript",
        {
          responseJsonSchema: expandScriptResponseSchema,
          systemInstruction: EXPAND_SCRIPT_SYSTEM,
          contents,
        },
        { runner: opts.runner },
      );

    let { data: raw, usage } = await runExpand();
    let { scripts, warnings, hardVoFail } = sanitizeScripts(
      raw,
      input.selected,
      input.brief,
    );
    const usages = [usage];

    // Hard VO band (outside soft min/max): retry expand once, then fail closed.
    if (hardVoFail && scripts.length > 0) {
      warnings.push("VO hard-band fail — retrying expandScript once");
      const retry = await runExpand();
      usages.push(retry.usage);
      const sanitized = sanitizeScripts(
        retry.data,
        input.selected,
        input.brief,
      );
      scripts = sanitized.scripts;
      warnings = [...warnings, ...sanitized.warnings];
      hardVoFail = sanitized.hardVoFail;
    }

    const hardFail = scripts.length === 0;
    if (hardFail) {
      return {
        status: "failed",
        data: null,
        execution: {
          calls: usages,
          errors: [
            {
              capability: "expandScript",
              errorType: "validation",
              errorMessage:
                warnings.join("; ") || "No valid scripts after validation",
            },
          ],
        },
        provenance,
      };
    }

    if (hardVoFail) {
      return {
        status: "failed",
        data: { scripts, warnings },
        execution: {
          calls: usages,
          errors: [
            {
              capability: "expandScript",
              errorType: "validation",
              errorMessage: warnings
                .filter((w) => /hard band|fail closed/i.test(w))
                .join("; "),
            },
          ],
        },
        provenance,
      };
    }

    return {
      status: "ok",
      data: { scripts, warnings },
      execution: { calls: usages, errors: [] },
      provenance,
    };
  } catch (err) {
    const usage = makeFailedUsage("expandScript", err);
    return {
      status: "failed",
      data: null,
      execution: {
        calls: [usage],
        errors: [
          {
            capability: "expandScript",
            errorType: usage.errorType ?? "unknown",
            errorMessage: usage.errorMessage ?? String(err),
          },
        ],
      },
      provenance,
    };
  }
}
