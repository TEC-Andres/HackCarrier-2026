"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export function HelloButton() {
  const [result, setResult] = useState<{
    message: string;
    source: string;
    target: string | null;
    status: number | null;
  } | null>(null);

  const helloBackend = api.post.helloBackend.useMutation({
    onSuccess: (data) => setResult(data),
    onError: (error) =>
      setResult({
        message: error.message,
        source: "error",
        target: null,
        status: null,
      }),
  });

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => helloBackend.mutate()}
        disabled={helloBackend.isPending}
        className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20 disabled:opacity-50"
      >
        {helloBackend.isPending ? "Requesting..." : "Say Hello (cURL)"}
      </button>

      {result ? (
        <div className="w-full rounded-xl bg-white/10 p-4 text-center">
          <p className="text-lg font-semibold">{result.message}</p>
          <p className="mt-1 text-sm opacity-80">
            source: {result.source}
            {result.status !== null ? ` · status: ${result.status}` : ""}
          </p>
          {result.target ? (
            <p className="mt-1 break-all text-xs opacity-60">{result.target}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
