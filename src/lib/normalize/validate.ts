import type { NormalizedProduct, NormalizeNotes } from "./types";
import { pushUnique } from "./types";

export type ValidateSlice = {
  title: string | null;
  description: string | null;
  imageCount: number;
  videoCount: number;
};

/**
 * Blocking readyForNextStage=false only when:
 * - missing title, or
 * - missing description, or
 * - images + videos both empty.
 */
export function validateNormalizedProduct(
  slice: ValidateSlice,
  notes: NormalizeNotes,
): NormalizedProduct["validation"] {
  if (!slice.title) {
    pushUnique(notes.missingFields, "text.title");
  }
  if (!slice.description) {
    pushUnique(notes.missingFields, "text.description");
  }
  if (slice.imageCount === 0 && slice.videoCount === 0) {
    pushUnique(notes.missingFields, "media.visual");
  }

  const readyForNextStage =
    Boolean(slice.title) &&
    Boolean(slice.description) &&
    slice.imageCount + slice.videoCount > 0;

  return {
    readyForNextStage,
    missingFields: [...notes.missingFields],
    invalidFields: [...notes.invalidFields],
    repairs: [...notes.repairs],
    warnings: [...notes.warnings],
  };
}
