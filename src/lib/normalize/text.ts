import type { ProductStageInput } from "@/lib/product-stage-input";
import { pushUnique, type NormalizeNotes } from "./types";

const HTML_TAG_RE = /<\/?[^>]+>/g;
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strip HTML tags, decode common entities, collapse whitespace, drop controls. */
export function cleanPlainText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw);
  s = s.replace(HTML_TAG_RE, " ");
  s = s.replace(
    /&(amp|lt|gt|quot|apos|nbsp);|&#39;/gi,
    (m) => ENTITY_MAP[m.toLowerCase()] ?? ENTITY_MAP[m] ?? " ",
  );
  // Remaining numeric entities → space (conservative, no guessing)
  s = s.replace(/&#\d+;|&[a-z]+;/gi, " ");
  // Drop C0 controls except tab/newline; normalize newlines
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.trim();
  return s || null;
}

export type NormalizedText = {
  title: string | null;
  description: string | null;
  bullets: string[];
  audience: string | null;
  notes: string | null;
};

export function normalizeText(
  input: ProductStageInput,
  notes: NormalizeNotes,
): NormalizedText {
  const title = cleanPlainText(input.product.title);
  const description = cleanPlainText(input.product.description);
  const audience = cleanPlainText(input.product.audience ?? null);
  const notesText = cleanPlainText(input.product.notes ?? null);

  if (input.product.title && title !== input.product.title.trim()) {
    pushUnique(notes.repairs, "text_title_cleaned");
  }
  if (
    input.product.description &&
    description !== input.product.description.trim()
  ) {
    pushUnique(notes.repairs, "text_description_cleaned");
  }

  const seen = new Set<string>();
  const bullets: string[] = [];
  let droppedEmpty = 0;
  let droppedDup = 0;
  let cleanedBullet = false;
  for (const raw of input.product.bullets ?? []) {
    const cleaned = cleanPlainText(raw);
    if (!cleaned) {
      droppedEmpty += 1;
      continue;
    }
    if (cleaned !== String(raw).trim()) cleanedBullet = true;
    if (seen.has(cleaned)) {
      droppedDup += 1;
      continue;
    }
    seen.add(cleaned);
    bullets.push(cleaned);
  }
  if (droppedEmpty) pushUnique(notes.repairs, "bullets_removed_empty");
  if (droppedDup) pushUnique(notes.repairs, "bullets_deduped");
  if (cleanedBullet) pushUnique(notes.repairs, "bullets_cleaned");

  return { title, description, bullets, audience, notes: notesText };
}
