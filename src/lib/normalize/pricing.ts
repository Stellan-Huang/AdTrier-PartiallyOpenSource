import type { ProductStageInput } from "@/lib/product-stage-input";
import { cleanPlainText } from "./text";
import {
  pushUnique,
  type MoneyAmount,
  type NormalizeNotes,
} from "./types";

const PSEUDO_EMPTY = new Set([
  "",
  "0",
  "0.0",
  "0.00",
  "null",
  "undefined",
  "n/a",
  "na",
]);

function missingMoney(raw: string | null): MoneyAmount {
  return { amountMajor: null, currency: null, raw, status: "missing" };
}

function invalidMoney(raw: string | null, currency: string | null): MoneyAmount {
  return { amountMajor: null, currency, raw, status: "invalid" };
}

/** Normalize currency to uppercase ISO-4217-like 3 letters, else null. */
export function normalizeCurrency(
  raw: string | null | undefined,
  notes: NormalizeNotes,
): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const t = String(raw).trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  pushUnique(notes.warnings, "currency_unrecognized");
  pushUnique(notes.invalidFields, "commercial.currency");
  return null;
}

function hasExplicitMoneyFormat(raw: string): boolean {
  // Currency symbol anywhere, or ISO code glued/spaced to the amount
  if (/[$€£¥₩]/.test(raw)) return true;
  if (/^[A-Za-z]{3}\s*[\d,]/.test(raw)) return true;
  if (/[\d,]\s*[A-Za-z]{3}$/.test(raw)) return true;
  return false;
}

/**
 * Conservative money parse — no cents guessing for bare integers.
 * ok: decimal amounts ($14.09, 1,409.00), or explicit currency format ($48, USD 36).
 * invalid: pure integers like "1409" with no currency marker in the string.
 * missing: empty / pseudo-zero / n/a.
 */
export function parseMoney(
  rawIn: string | null | undefined,
  currency: string | null,
  fieldPath: string,
  notes: NormalizeNotes,
): MoneyAmount {
  if (rawIn == null) return missingMoney(null);
  const raw = String(rawIn).trim();
  if (!raw) return missingMoney(null);

  const lower = raw.toLowerCase();
  if (PSEUDO_EMPTY.has(lower)) {
    return missingMoney(raw);
  }

  const explicitFormat = hasExplicitMoneyFormat(raw);

  // Strip currency symbols / codes for numeric parse
  let numeric = raw
    .replace(/^[A-Za-z]{3}\s*/i, "")
    .replace(/\s*[A-Za-z]{3}$/i, "")
    .replace(/[$€£¥₩]/g, "")
    .trim();

  // Thousand separators: 1,409.00 → 1409.00
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(numeric)) {
    numeric = numeric.replace(/,/g, "");
  }

  // Pure integer with no decimal point
  if (/^\d+$/.test(numeric)) {
    if (!explicitFormat) {
      pushUnique(notes.warnings, "price_ambiguous_integer");
      pushUnique(notes.invalidFields, fieldPath);
      return invalidMoney(raw, currency);
    }
    const amountMajor = Number(numeric);
    if (!Number.isFinite(amountMajor)) {
      pushUnique(notes.invalidFields, fieldPath);
      return invalidMoney(raw, currency);
    }
    return { amountMajor, currency, raw, status: "ok" };
  }

  // Decimal amount
  if (/^\d+\.\d+$/.test(numeric)) {
    const amountMajor = Number(numeric);
    if (!Number.isFinite(amountMajor)) {
      pushUnique(notes.invalidFields, fieldPath);
      return invalidMoney(raw, currency);
    }
    return { amountMajor, currency, raw, status: "ok" };
  }

  pushUnique(notes.invalidFields, fieldPath);
  pushUnique(notes.warnings, "price_unparseable");
  return invalidMoney(raw, currency);
}

function formatMoneyForSummary(m: MoneyAmount): string {
  if (m.status !== "ok" || m.amountMajor == null) return m.raw ?? "";
  const n = m.amountMajor;
  const display =
    m.raw && /\.\d/.test(m.raw)
      ? n.toFixed(2)
      : Number.isInteger(n)
        ? String(n)
        : n.toFixed(2);
  if (m.currency === "USD") return `$${display}`;
  if (m.currency) return `${display} ${m.currency}`;
  // Prefer symbol from raw when present
  if (m.raw && m.raw.trim().startsWith("$")) return `$${display}`;
  return display;
}

export type NormalizedCommercial = {
  listPrice: MoneyAmount;
  originalPrice: MoneyAmount;
  promoPrice: MoneyAmount;
  promotionDetails: string | null;
  promotionValid: boolean;
  promotionalSummary: string | null;
};

export function normalizePricing(
  input: ProductStageInput,
  notes: NormalizeNotes,
): NormalizedCommercial {
  const pricing = input.product.pricing ?? {};
  const currency = normalizeCurrency(pricing.currency, notes);

  const listPrice = parseMoney(
    pricing.listPrice,
    currency,
    "commercial.listPrice",
    notes,
  );
  const originalPrice = parseMoney(
    pricing.originalPrice,
    currency,
    "commercial.originalPrice",
    notes,
  );
  const promoPrice = parseMoney(
    pricing.promoPrice,
    currency,
    "commercial.promoPrice",
    notes,
  );

  const detailsClean = cleanPlainText(pricing.promotionDetails ?? null);

  const promotionValid =
    originalPrice.status === "ok" &&
    promoPrice.status === "ok" &&
    originalPrice.amountMajor != null &&
    promoPrice.amountMajor != null &&
    originalPrice.amountMajor > promoPrice.amountMajor;

  let promotionDetails: string | null = null;
  let promotionalSummary: string | null = null;

  if (promotionValid) {
    promotionDetails = detailsClean;
    const parts = [
      `Was ${formatMoneyForSummary(originalPrice)} · Now ${formatMoneyForSummary(promoPrice)}`,
    ];
    if (detailsClean) parts.push(detailsClean);
    promotionalSummary = parts.join(" · ");
  } else {
    if (detailsClean) {
      pushUnique(notes.warnings, "promotion_details_ignored_invalid");
      pushUnique(notes.invalidFields, "commercial.promotionDetails");
    }
    if (pricing.promotionalSummary) {
      pushUnique(notes.repairs, "promotional_summary_cleared");
    }
  }

  return {
    listPrice,
    originalPrice,
    promoPrice,
    promotionDetails,
    promotionValid,
    promotionalSummary,
  };
}
