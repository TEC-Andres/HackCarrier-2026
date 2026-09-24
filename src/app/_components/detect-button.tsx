"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

type DetectionView = {
  vehicleLabel: string;
  readingCount: number;
  newAlertCount: number;
  totalAlertCount: number;
  anomalies: {
    type: string;
    confidence: number;
    reason: string;
  }[];
};

export function DetectButton() {
  const [result, setResult] = useState<DetectionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detect = api.vehicle.detect.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
      setResult(null);
    },
  });

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => detect.mutate()}
        disabled={detect.isPending}
        className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20 disabled:opacity-50"
      >
        {detect.isPending ? "Detecting..." : "Run Fuel Detection (serverless)"}
      </button>

      {error ? (
        <div className="w-full rounded-xl bg-white/10 p-4 text-center">
          <p className="text-sm opacity-80">{error}</p>
        </div>
      ) : null}

      {result ? (
        <div className="w-full rounded-xl bg-white/10 p-4 text-center">
          <p className="text-lg font-semibold">
            {result.vehicleLabel}: {result.readingCount} readings, +
            {result.newAlertCount} new alerts ({result.totalAlertCount} total)
          </p>
          <p className="mt-1 text-xs opacity-60">source: vehicle.detect</p>
          <ul className="mt-3 space-y-2 text-left">
            {result.anomalies.map((anomaly) => (
              <li key={`${anomaly.type}-${anomaly.confidence}`} className="rounded-lg bg-black/20 p-2">
                <p className="text-sm font-semibold">
                  {anomaly.type} · confidence {anomaly.confidence.toFixed(2)}
                </p>
                <p className="text-xs opacity-75">{anomaly.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
