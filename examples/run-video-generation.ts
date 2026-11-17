import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAd } from "../src/lib/workflow/generation";
import type { CreativeBrief } from "../src/lib/workflow/creative/types";
import type { Script } from "../src/lib/workflow/creative/v2/types";

type PipelineArtifact = {
  creative?: {
    brief?: CreativeBrief;
    scripts?: Script[];
  };
};

async function main(): Promise<void> {
  const inputPath = join(process.cwd(), "output", "pipeline-result.json");
  if (!existsSync(inputPath)) {
    throw new Error("Run `npm run demo` first; output/pipeline-result.json is missing.");
  }

  const publicImageUrl = process.env.PUBLIC_PRODUCT_IMAGE_URL?.trim();
  if (!publicImageUrl || !/^https?:\/\//i.test(publicImageUrl)) {
    throw new Error(
      "Set PUBLIC_PRODUCT_IMAGE_URL to a publicly fetchable HTTP(S) product image URL.",
    );
  }

  const artifact = JSON.parse(readFileSync(inputPath, "utf8")) as PipelineArtifact;
  const brief = artifact.creative?.brief;
  const script = artifact.creative?.scripts?.[0];

  if (!brief || !script) {
    throw new Error("The pipeline result does not contain a brief and a generated script.");
  }

  const assetUrls = Object.fromEntries(
    brief.assets.images.map((image) => [image.assetId, publicImageUrl]),
  );

  const result = await generateAd(script, brief, {
    generationQuality: "preview",
    validate: true,
    skipSnapshots: true,
    assets: { assetUrls },
  });

  if (result.status !== "ok" || !result.data) {
    console.error("Video generation failed:", result.execution.errors);
    process.exitCode = 1;
    return;
  }

  const outputDir = join(process.cwd(), "output");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "video-generation-result.json");

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        status: result.status,
        data: result.data,
        execution: result.execution,
        provenance: result.provenance,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Video generation complete. Manifest written to ${outputPath}`);
  console.log(`Composed output: ${result.data.composedUrl}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
