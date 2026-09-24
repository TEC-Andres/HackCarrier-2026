import type { FuelReading } from "../../generated/prisma";

const SMOOTHING_WINDOW = 5;
const DROP_THRESHOLD_PERCENT = 5;
const RECOVERY_WINDOW = 6;
const STOPPED_SPEED_THRESHOLD = 1;

type Classification = {
  type: "POTHOLE_OR_SLOSH" | "LEAK" | "THEFT" | "UNKNOWN";
  confidence: number;
  reason: string;
  dropAmount: number;
  atIndex: number;
};

function smooth(readings: FuelReading[]): number[] {
  return readings.map((_, i) => {
    const start = Math.max(0, i - SMOOTHING_WINDOW + 1);
    const window = readings.slice(start, i + 1);
    const sum = window.reduce((acc, r) => acc + r.level, 0);
    return sum / window.length;
  });
}

export function detectAnomalies(readings: FuelReading[]): Classification[] {
  if (readings.length < SMOOTHING_WINDOW + RECOVERY_WINDOW) return [];

  const smoothed = smooth(readings);
  const results: Classification[] = [];
  let lastFlaggedIndex = -RECOVERY_WINDOW;

  for (let i = SMOOTHING_WINDOW; i < smoothed.length; i++) {
    if (i - lastFlaggedIndex < RECOVERY_WINDOW) continue;

    const lookback = Math.max(0, i - RECOVERY_WINDOW);
    const before = smoothed[lookback]!;
    const after = smoothed[i]!;
    const dropPercent = ((before - after) / before) * 100;

    if (dropPercent < DROP_THRESHOLD_PERCENT) continue;

    const recoveryEnd = Math.min(smoothed.length - 1, i + RECOVERY_WINDOW);
    const recoveredLevel = smoothed[recoveryEnd]!;
    const recovered = recoveredLevel >= before - (before - after) * 0.3;

    const window = readings.slice(lookback, i + 1);
    const stoppedTicks = window.filter((r) => r.speed !== null && r.speed < STOPPED_SPEED_THRESHOLD).length;
    const wasStopped = stoppedTicks / window.length > 0.3;
    const dropWasGradual = dropPercent < DROP_THRESHOLD_PERCENT * 2;

    let classification: Classification;

    if (recovered) {
      classification = {
        type: "POTHOLE_OR_SLOSH",
        confidence: Math.min(0.95, 0.6 + dropPercent / 100),
        reason: `Fuel level dropped ${dropPercent.toFixed(1)}% then recovered within ${RECOVERY_WINDOW} readings, consistent with tank sloshing or a bump.`,
        dropAmount: before - after,
        atIndex: i,
      };
    } else if (wasStopped && !dropWasGradual) {
      classification = {
        type: "THEFT",
        confidence: Math.min(0.9, 0.5 + dropPercent / 50),
        reason: `Sudden ${dropPercent.toFixed(1)}% drop while vehicle was stationary, level did not recover. Consistent with unauthorized extraction.`,
        dropAmount: before - after,
        atIndex: i,
      };
    } else if (dropWasGradual) {
      classification = {
        type: "LEAK",
        confidence: Math.min(0.85, 0.5 + dropPercent / 60),
        reason: `Gradual ${dropPercent.toFixed(1)}% drop that did not recover, consistent with a slow leak.`,
        dropAmount: before - after,
        atIndex: i,
      };
    } else {
      classification = {
        type: "UNKNOWN",
        confidence: 0.4,
        reason: `${dropPercent.toFixed(1)}% drop did not match a clear pattern, needs manual review.`,
        dropAmount: before - after,
        atIndex: i,
      };
    }

    results.push(classification);
    lastFlaggedIndex = i;
  }

  return results;
}