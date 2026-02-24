export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterMs(baseMs: number): number {
  const spread = Math.max(50, Math.floor(baseMs * 0.25));
  return baseMs + Math.floor((Math.random() * 2 - 1) * spread);
}

