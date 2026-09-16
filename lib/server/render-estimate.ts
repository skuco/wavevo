// Measure only frame generation: audio preparation and browser startup have a
// different cost and should not inflate the per-frame estimate.
export function estimateRenderRemainingMs(frames: number, totalFrames: number, elapsedMs: number): number | null {
  if (![frames, totalFrames, elapsedMs].every(Number.isFinite) || elapsedMs < 2000 || frames < 15 || frames >= totalFrames) return null;
  const remainingFramesMs = elapsedMs / frames * (totalFrames - frames);
  // Leave a small allowance for draining the encoder and writing the container.
  return Math.round(remainingFramesMs + Math.max(1000, elapsedMs * 0.05));
}
