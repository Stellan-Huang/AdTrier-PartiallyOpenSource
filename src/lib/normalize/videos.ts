import {
  resolvePublicMediaUrl,
  type ProductStageInput,
  type ProductStageMediaItem,
} from "@/lib/product-stage-input";
import {
  mediaStableId,
  parseMediaMeta,
  toCanonicalUrl,
} from "./images";
import {
  pushUnique,
  type NormalizedVideo,
  type NormalizeNotes,
} from "./types";

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

export function normalizeVideos(
  input: ProductStageInput,
  notes: NormalizeNotes,
): NormalizedVideo[] {
  const usedIds = new Set<string>();
  const seenCanonical = new Set<string>();
  const videos: NormalizedVideo[] = [];
  let deduped = 0;

  (input.media.videos ?? []).forEach((item: ProductStageMediaItem, sourceIndex: number) => {
    const resolved = resolvePublicMediaUrl(item.url || "");
    const url = resolved.url;
    if (resolved.unresolvedRelative) {
      pushUnique(notes.warnings, "video_unresolved_relative_url");
      pushUnique(notes.invalidFields, `media.videos[${sourceIndex}]`);
      return;
    }

    const canonicalUrl = toCanonicalUrl(url);
    if (!canonicalUrl) {
      pushUnique(notes.invalidFields, `media.videos[${sourceIndex}]`);
      pushUnique(notes.warnings, "video_invalid_url");
      return;
    }

    if (seenCanonical.has(canonicalUrl)) {
      deduped += 1;
      return;
    }
    seenCanonical.add(canonicalUrl);

    const meta = parseMediaMeta(url, item.fileName);
    const fallback = mediaStableId("vid_", canonicalUrl);
    const id = allocateId(item.id, fallback, usedIds);

    videos.push({
      id,
      url,
      canonicalUrl,
      fileName: meta.fileName,
      extension: meta.extension,
      host: meta.host,
      sourceIndex,
    });
  });

  if (deduped) {
    pushUnique(notes.repairs, "videos_deduped_by_canonical_url");
  }

  return videos;
}
