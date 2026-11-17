import {
  resolvePublicMediaUrl,
  type ProductStageInput,
} from "@/lib/product-stage-input";
import { mediaStableId, parseMediaMeta, toCanonicalUrl } from "./images";
import {
  pushUnique,
  type NormalizedLogo,
  type NormalizeNotes,
} from "./types";

export type NormalizedBrandingBundle = {
  identity: {
    sourceUrl: string | null;
    sourceKind: string | null;
    asin: string | null;
  };
  branding: { logo: NormalizedLogo | null };
};

export function normalizeBranding(
  input: ProductStageInput,
  notes: NormalizeNotes,
): NormalizedBrandingBundle {
  const sourceUrl = (input.source.url || "").trim() || null;
  const sourceKind = (input.source.kind || "").trim() || null;
  const asin = (input.source.asin || "").trim() || null;

  let logo: NormalizedLogo | null = null;
  const rawLogo = (input.branding.logoUrl || "").trim();
  if (rawLogo) {
    const resolved = resolvePublicMediaUrl(rawLogo);
    const url = resolved.url;
    if (resolved.unresolvedRelative) {
      pushUnique(notes.warnings, "logo_unresolved_relative_url");
      pushUnique(notes.invalidFields, "branding.logo");
    } else {
      const canonicalUrl = toCanonicalUrl(url);
      if (!canonicalUrl) {
        pushUnique(notes.invalidFields, "branding.logo");
        pushUnique(notes.warnings, "logo_invalid_url");
      } else {
        const meta = parseMediaMeta(url, null);
        logo = {
          id: mediaStableId("logo_", canonicalUrl),
          url,
          fileName: meta.fileName,
          extension: meta.extension,
          host: meta.host,
        };
      }
    }
  }

  return {
    identity: { sourceUrl, sourceKind, asin },
    branding: { logo },
  };
}
