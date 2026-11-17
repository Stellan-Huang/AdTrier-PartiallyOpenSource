/**
 * Seedream 5.0 stub — exported for future use; NOT called on MAP default path.
 * Env: SEEDREAM_5_0_API
 */

export type SeedreamGenerateInput = {
  prompt: string;
  referenceImageUrl?: string;
};

export type SeedreamGenerateResult = {
  imageUrl: string;
  model: string;
  latencyMs: number;
};

/**
 * Stub: throws until a MAP path explicitly opts in.
 * Default generateAd routing never invokes this.
 */
export async function generateSeedreamImage(
  _input: SeedreamGenerateInput,
): Promise<SeedreamGenerateResult> {
  void _input;
  throw new Error(
    "Seedream is stubbed unused on MAP path. Set an explicit non-MAP caller before enabling SEEDREAM_5_0_API.",
  );
}

export function isSeedreamConfigured(): boolean {
  return Boolean(process.env.SEEDREAM_5_0_API?.trim());
}
