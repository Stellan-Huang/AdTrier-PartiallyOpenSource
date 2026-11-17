import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  fixedClock,
  normalizeProductStageInput,
} from "./index";
import type { ProductStageInput } from "@/lib/product-stage-input";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXED_ISO = "2026-09-26T12:00:00.000Z";
const clock = fixedClock(FIXED_ISO);

function loadSampleProduct(): ProductStageInput {
  const raw = readFileSync(
    join(__dirname, "fixtures/sample-product-stage-input.json"),
    "utf8",
  );
  return JSON.parse(raw) as ProductStageInput;
}

function baseInput(
  overrides: Partial<ProductStageInput> = {},
): ProductStageInput {
  const base: ProductStageInput = {
    version: 1,
    jobId: "job_test",
    source: { url: "https://shop.example.com/p", kind: "shopify" },
    product: {
      title: "Test Product",
      description: "A solid description for ads.",
      bullets: ["One", "Two"],
      pricing: {},
    },
    branding: {},
    media: {
      images: [
        {
          id: "img_a",
          url: "https://cdn.example.com/a.jpg",
          fileName: "a.jpg",
        },
      ],
      videos: [],
      primaryImageUrl: "https://cdn.example.com/a.jpg",
    },
      completeness: { readyForNextStage: true, missing: [] },
  };
  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...(overrides.source || {}) },
    product: {
      ...base.product,
      ...(overrides.product || {}),
      pricing: {
        ...base.product.pricing,
        ...(overrides.product?.pricing || {}),
      },
    },
    branding: { ...base.branding, ...(overrides.branding || {}) },
    media: {
      ...base.media,
      ...(overrides.media || {}),
      images: overrides.media?.images ?? base.media.images,
      videos: overrides.media?.videos ?? base.media.videos,
    },
    completeness: {
      ...base.completeness,
      ...(overrides.completeness || {}),
    },
  };
}

describe("normalizeProductStageInput — sample product fixture", () => {
  it("marks integer prices invalid, dedupes images, keeps ready", () => {
    const input = loadSampleProduct();
    const out = normalizeProductStageInput(input, { clock });

    assert.equal(out.version, 1);
    assert.equal(out.jobId, "sample-job-001");
    assert.equal(out.provenance.generatedAt, FIXED_ISO);
    assert.equal(out.provenance.fromStageInput, true);

    assert.equal(out.text.title, "Insulated Travel Bottle");
    assert.ok(out.text.description && out.text.description.length > 20);
    assert.ok(out.text.bullets.length >= 4);
    assert.equal(out.text.bullets.includes(""), false);

    assert.equal(out.commercial.listPrice.status, "invalid");
    assert.equal(out.commercial.listPrice.raw, "1499");
    assert.equal(out.commercial.listPrice.amountMajor, null);
    assert.equal(out.commercial.originalPrice.status, "missing");
    assert.equal(out.commercial.promoPrice.status, "invalid");
    assert.equal(out.commercial.promotionValid, false);
    assert.equal(out.commercial.promotionDetails, null);
    assert.equal(out.commercial.promotionalSummary, null);
    assert.ok(
      out.validation.warnings.includes("price_ambiguous_integer"),
    );

    // 5 raw → 4 unique (first two share pathname)
    assert.equal(out.media.images.length, 4);
    assert.equal(out.media.videos.length, 0);
    assert.ok(
      out.validation.repairs.includes("images_deduped_by_canonical_url"),
    );
    assert.equal(out.media.primaryImageId, out.media.images[0].id);
    assert.equal(out.media.images[0].isPrimary, true);
    assert.ok(out.media.images[0].canonicalUrl.endsWith(
      "/products/bottle-front.jpg",
    ));
    assert.equal(
      out.media.images[0].url.includes("?rev="),
      true,
      "fetch URL keeps query",
    );
    assert.equal(out.media.images[0].fileName?.includes("?"), false);

    assert.equal(out.branding.logo, null);
    assert.equal(out.validation.readyForNextStage, true);
  });
});

describe("normalizeProductStageInput — pricing edges", () => {
  it("accepts $48 / $36 as valid promotion", () => {
    const out = normalizeProductStageInput(
      baseInput({
        product: {
          title: "AuraGlow",
          description: "Serum",
          bullets: [],
          pricing: {
            currency: "USD",
            listPrice: "$48",
            originalPrice: "$48",
            promoPrice: "$36",
            promotionDetails: "20% off this week",
          },
        },
      }),
      { clock },
    );
    assert.equal(out.commercial.originalPrice.status, "ok");
    assert.equal(out.commercial.originalPrice.amountMajor, 48);
    assert.equal(out.commercial.promoPrice.status, "ok");
    assert.equal(out.commercial.promoPrice.amountMajor, 36);
    assert.equal(out.commercial.promotionValid, true);
    assert.equal(out.commercial.promotionDetails, "20% off this week");
    assert.match(
      out.commercial.promotionalSummary || "",
      /Was \$48 · Now \$36 · 20% off this week/,
    );
  });

  it("treats missing prices as missing (not invalid)", () => {
    const out = normalizeProductStageInput(baseInput(), { clock });
    assert.equal(out.commercial.listPrice.status, "missing");
    assert.equal(out.commercial.originalPrice.status, "missing");
    assert.equal(out.commercial.promoPrice.status, "missing");
    assert.equal(out.commercial.promotionValid, false);
    assert.equal(out.validation.readyForNextStage, true);
  });
});

describe("normalizeProductStageInput — media edges", () => {
  it("blocks when images and videos are empty", () => {
    const out = normalizeProductStageInput(
      baseInput({
        media: { images: [], videos: [] },
      }),
      { clock },
    );
    assert.equal(out.validation.readyForNextStage, false);
    assert.ok(out.validation.missingFields.includes("media.visual"));
  });

  it("dedupes same path different query to one image", () => {
    const out = normalizeProductStageInput(
      baseInput({
        media: {
          images: [
            {
              id: "a",
              url: "https://cdn.example.com/x.jpg?v=1",
              fileName: "x.jpg?v=1",
            },
            {
              id: "b",
              url: "https://cdn.example.com/x.jpg?v=2",
              fileName: "x.jpg?v=2",
            },
          ],
          videos: [],
          primaryImageUrl: "https://cdn.example.com/x.jpg?v=1",
        },
      }),
      { clock },
    );
    assert.equal(out.media.images.length, 1);
    assert.equal(out.media.images[0].canonicalUrl, "https://cdn.example.com/x.jpg");
    assert.equal(out.media.images[0].fileName, "x.jpg");
  });

  it("drops invalid image URLs", () => {
    const out = normalizeProductStageInput(
      baseInput({
        media: {
          images: [
            { id: "bad", url: "not-a-url", fileName: "x" },
            {
              id: "ok",
              url: "https://cdn.example.com/ok.png",
              fileName: "ok.png",
            },
          ],
          videos: [],
          primaryImageUrl: "https://cdn.example.com/ok.png",
        },
      }),
      { clock },
    );
    assert.equal(out.media.images.length, 1);
    assert.equal(out.media.images[0].id, "ok");
    assert.ok(
      out.validation.invalidFields.some((f) =>
        f.startsWith("media.images["),
      ),
    );
  });

  it("blocks without title or description", () => {
    const noTitle = normalizeProductStageInput(
      baseInput({
        product: {
          title: "   ",
          description: "Desc",
          bullets: [],
          pricing: {},
        },
      }),
      { clock },
    );
    assert.equal(noTitle.validation.readyForNextStage, false);
    assert.ok(noTitle.validation.missingFields.includes("text.title"));

    const noDesc = normalizeProductStageInput(
      baseInput({
        product: {
          title: "Title",
          description: "",
          bullets: [],
          pricing: {},
        },
      }),
      { clock },
    );
    assert.equal(noDesc.validation.readyForNextStage, false);
    assert.ok(noDesc.validation.missingFields.includes("text.description"));
  });

  it("cleans HTML in text and dedupes bullets exactly", () => {
    const out = normalizeProductStageInput(
      baseInput({
        product: {
          title: "<b>Hello</b> &amp; Co",
          description: "Line one<br/>Line two",
          bullets: ["Alpha", "Alpha", "  Beta  ", ""],
          pricing: {},
        },
      }),
      { clock },
    );
    assert.equal(out.text.title, "Hello & Co");
    assert.ok(!out.text.description?.includes("<"));
    assert.deepEqual(out.text.bullets, ["Alpha", "Beta"]);
  });

});
