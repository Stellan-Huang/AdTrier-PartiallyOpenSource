import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProductIntelligence, createCreativeFlow } from "../src/lib/workflow";
import { sampleProductInput } from "./sample-product";

const here = dirname(fileURLToPath(import.meta.url));
const sampleImageUrl = "https://assets.example.test/sample-bottle.png";
const sampleImage = readFileSync(join(here, "assets", "sample-bottle.png"));

const fetchSampleImage: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (url === sampleImageUrl) {
    return new Response(sampleImage, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }

  return fetch(input, init);
};

async function main(): Promise<void> {
  if (!process.env.SEED_2_1_LITE_API?.trim() && !process.env.ARK_API_KEY?.trim()) {
    throw new Error(
      "Set SEED_2_1_LITE_API (or ARK_API_KEY) in .env before running the live example.",
    );
  }

  const product = await runProductIntelligence(sampleProductInput, {
    skipCache: true,
    fetchImpl: fetchSampleImage,
  });

  if (product.status !== "ok" || !product.data) {
    console.error("Product Intelligence failed:", product.execution.errors);
    process.exitCode = 1;
    return;
  }

  const creative = await createCreativeFlow(product.data, {
    skipSnapshots: true,
    userContext: {
      audience: sampleProductInput.product.audience,
      instructions: sampleProductInput.product.notes,
    },
  });

  if (creative.status !== "ok" || !creative.data) {
    console.error("Creative V2 failed:", creative.execution.errors);
    process.exitCode = 1;
    return;
  }

  const outputDir = join(process.cwd(), "output");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "pipeline-result.json");

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        productUnderstanding: product.data,
        creative: creative.data,
        execution: {
          productIntelligence: product.execution,
          creative: creative.execution,
        },
        provenance: {
          productIntelligence: product.provenance,
          creative: creative.provenance,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Pipeline complete. Result written to ${outputPath}`);
  console.log(`Facts: ${product.data.facts.length}`);
  console.log(`Creative candidates: ${creative.data.creatives.length}`);
  console.log(`Selected creatives: ${creative.data.selected.length}`);
  console.log(`Scripts: ${creative.data.scripts.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
