/** Injectable clock for deterministic `generatedAt` in tests. */
export type NormalizeClock = {
  now: () => Date;
};

export const systemClock: NormalizeClock = {
  now: () => new Date(),
};

export function fixedClock(iso: string): NormalizeClock {
  const d = new Date(iso);
  return { now: () => d };
}
