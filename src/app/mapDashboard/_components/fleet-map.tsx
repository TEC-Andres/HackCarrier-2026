"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  LngLatBounds,
  setWorkerUrl,
  type ErrorEvent as MapLibreErrorEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Next.js's bundlers don't resolve maplibre-gl's `new URL(..., import.meta.url)`
// worker reference, so the worker 404s unless we point it at a copy served from
// /public (see public/maplibre-gl-worker.mjs, copied from the installed package).
setWorkerUrl("/maplibre-gl-worker.mjs");
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { MapVehicle } from "./types";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Matches the app's design tokens (globals.css): --destructive, emerald-600 (badge
// "success"), and --accent, expressed as RGB since deck.gl doesn't read CSS vars.
const COLOR_ALERT: [number, number, number] = [220, 38, 38];
const COLOR_OK: [number, number, number] = [5, 150, 105];
const COLOR_SELECTED_RING: [number, number, number] = [37, 99, 235];
const COLOR_WHITE: [number, number, number, number] = [255, 255, 255, 255];

export function FleetMap({
  vehicles,
  selectedId,
  onSelect,
  onReady,
  onError,
}: {
  vehicles: MapVehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReady: () => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vehiclesRef = useRef(vehicles);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  vehiclesRef.current = vehicles;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let frame = 0;

    const map = new MapLibreMap({
      container,
      style: MAP_STYLE,
      center: [-100.5, 22.8],
      zoom: 4.6,
      attributionControl: { compact: true },
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);

    const buildLayers = (pulse: number) => {
      const vs = vehiclesRef.current;
      const sel = selectedRef.current;

      overlay.setProps({
        layers: [
          new ScatterplotLayer<MapVehicle>({
            id: "vehicles-pulse",
            data: vs.filter((v) => v.hasAlert),
            getPosition: (v) => [v.lng, v.lat],
            getRadius: 14 + pulse * 12,
            radiusUnits: "pixels",
            stroked: false,
            filled: true,
            getFillColor: [...COLOR_ALERT, Math.round((1 - pulse) * 130)],
            updateTriggers: { getRadius: pulse, getFillColor: pulse },
          }),
          new ScatterplotLayer<MapVehicle>({
            id: "vehicles-selected-ring",
            data: sel ? vs.filter((v) => v.id === sel) : [],
            getPosition: (v) => [v.lng, v.lat],
            getRadius: 15,
            radiusUnits: "pixels",
            stroked: true,
            filled: false,
            lineWidthUnits: "pixels",
            getLineWidth: 2,
            getLineColor: COLOR_SELECTED_RING,
          }),
          new ScatterplotLayer<MapVehicle>({
            id: "vehicles-dot",
            data: vs,
            pickable: true,
            autoHighlight: true,
            getPosition: (v) => [v.lng, v.lat],
            getRadius: 7,
            radiusUnits: "pixels",
            stroked: true,
            filled: true,
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            getLineColor: COLOR_WHITE,
            getFillColor: (v) => (v.hasAlert ? COLOR_ALERT : COLOR_OK),
            updateTriggers: { getFillColor: vs.map((v) => v.hasAlert).join(",") },
            onClick: (info: PickingInfo<MapVehicle>) => {
              if (info.object) onSelectRef.current(info.object.id);
            },
          }),
        ],
      });
    };

    const animate = (t: number) => {
      buildLayers((Math.sin(t / 700) + 1) / 2);
      frame = requestAnimationFrame(animate);
    };

    map.on("load", () => {
      if (cancelled) return;
      map.resize();

      const initial = vehiclesRef.current;
      if (initial.length > 0) {
        const first = initial[0]!;
        const bounds = initial.reduce(
          (b, v) => b.extend([v.lng, v.lat]),
          new LngLatBounds([first.lng, first.lat], [first.lng, first.lat])
        );
        map.fitBounds(bounds, { padding: 72, maxZoom: 7, duration: 0 });
      }

      frame = requestAnimationFrame(animate);
      onReadyRef.current();
    });

    map.on("error", (e: MapLibreErrorEvent) => {
      console.error("[FleetMap] maplibre error", e.error);
      onErrorRef.current();
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      map.remove();
    };
    // Map is created once; live vehicle/selection data flows in via refs above.
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden rounded-lg">
      {/* maplibre-gl.css forces position:relative on its container via the
          .maplibregl-map class, which wins the cascade over an `absolute`
          utility applied to the same element and collapses it to 0 height.
          Keeping the positioning on this wrapper and handing maplibre a
          plain h-full/w-full child avoids that fight. */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
