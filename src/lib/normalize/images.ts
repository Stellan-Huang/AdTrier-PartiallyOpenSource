import { createHash } from "node:crypto";
import {
  resolvePublicMediaUrl,
  type ProductStageInput,
  type ProductStageMediaItem,
} from "@/lib/product-stage-input";
import {
  pushUnique,
  type NormalizedImage,
  type NormalizeNotes,
} from "./types";

export function mediaStableId(
  prefix: "img_" | "vid_" | "logo_",
  canonicalUrl: string,
): string {
  const hash = createHash("sha256")
    .update(canonicalUrl)
    .digest("hex")
    .slice(0, 12);
  return `${prefix}${hash}`;
}

/** Dedup key: origin + pathname (drop search/hash). Relative → null. */
export function toCanonicalUrl(url: string): string | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

export function parseMediaMeta(
  url: string,
  fileNameHint?: string | null,
): {
  fileName: string | null;
  extension: string | null;
  host: string | null;
} {
  let host: string | null = null;
  let pathName = "";
  try {
    const u = new URL(url);
    host = u.host || null;
    pathName = u.pathname || "";
  } catch {
    /* ignore */
  }

  let fileName: string | null = null;
  const rawHint = (fileNameHint || "").trim();
  if (rawHint) {
    // Strip path segments and query/hash leftovers from fileName hint
    const base = rawHint.split(/[\\/]/).pop() || rawHint;
    fileName = base.split("?")[0].split("#")[0].replace(/[\u0000-\u001F\u007F]/g, "").trim() || null;
  }
  if (!fileName && pathName) {
    const base = pathName.split("/").pop() || "";
    fileName = base.replace(/[\u0000-\u001F\u007F]/g, "").trim() || null;
  }

  let extension: string | null = null;
  const fromName = fileName?.match(/\.([A-Za-z0-9]{1,8})$/);
  if (fromName) extension = fromName[1].toLowerCase();
  else {
    const fromPath = pathName.match(/\.([A-Za-z0-9]{1,8})$/);
    if (fromPath) extension = fromPath[1].toLowerCase();
  }

  return { fileName, extension, host };
}

function allocateId(
  preferred: string | undefined,
  fallback: string,
  used: Set<string>,
): string {
  let id = (preferred || "").trim() || fallback;
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let n = 2;
  while (used.has(`${id}__${n}`)) n += 1;
  const next = `${id}__${n}`;
  used.add(next);
  return next;
}

export type NormalizedImagesResult = {
  images: NormalizedImage[];
  primaryImageId: string | null;
  primaryImageUrl: string | null;
};

export function normalizeImages(
  input: ProductStageInput,
  notes: NormalizeNotes,
): NormalizedImagesResult {
  const usedIds = new Set<string>();
  const seenCanonical = new Set<string>();
  const images: NormalizedImage[] = [];
  let deduped = 0;

  (input.media.images ?? []).forEach((item: ProductStageMediaItem, sourceIndex: number) => {
    const resolved = resolvePublicMediaUrl(item.url || "");
    const url = resolved.url;
    if (resolved.unresolvedRelative) {
      pushUnique(notes.warnings, "image_unresolved_relative_url");
      pushUnique(notes.invalidFields, `media.images[${sourceIndex}]`);
      return;
    }

    const canonicalUrl = toCanonicalUrl(url);
    if (!canonicalUrl) {
      pushUnique(notes.invalidFields, `media.images[${sourceIndex}]`);
      pushUnique(notes.warnings, "image_invalid_url");
      return;
    }

    if (seenCanonical.has(canonicalUrl)) {
      deduped += 1;
      return;
    }
    seenCanonical.add(canonicalUrl);

    const meta = parseMediaMeta(url, item.fileName);
    const fallback = mediaStableId("img_", canonicalUrl);
    const id = allocateId(item.id, fallback, usedIds);

    images.push({
      id,
      url,
      canonicalUrl,
      fileName: meta.fileName,
      extension: meta.extension,
      host: meta.host,
      sourceIndex,
      isPrimary: false,
    });
  });

  if (deduped) {
    pushUnique(notes.repairs, "images_deduped_by_canonical_url");
  }

  let primaryImageId: string | null = null;
  let primaryImageUrl: string | null = null;

  const primaryHint = (input.media.primaryImageUrl || "").trim();
  if (primaryHint && images.length) {
    const primaryCanonical = toCanonicalUrl(resolvePublicMediaUrl(primaryHint).url);
    const hit = primaryCanonical
      ? images.find((img) => img.canonicalUrl === primaryCanonical)
      : undefined;
    if (hit) {
      hit.isPrimary = true;
      primaryImageId = hit.id;
      primaryImageUrl = hit.url;
    }
  }

  if (!primaryImageId && images.length) {
    images[0].isPrimary = true;
    primaryImageId = images[0].id;
    primaryImageUrl = images[0].url;
    if (primaryHint) {
      pushUnique(notes.warnings, "primary_image_fallback_first");
      pushUnique(notes.repairs, "primary_image_set_to_first");
    }
  }

  if (!images.length) {
    pushUnique(notes.missingFields, "media.images");
    if (primaryHint) {
      pushUnique(notes.warnings, "primary_image_missing_no_images");
    }
  }

  return { images, primaryImageId, primaryImageUrl };
}
