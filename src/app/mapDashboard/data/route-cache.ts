import type { RoutePoint } from "./fleet-routes";

export type LngLat = [number, number];

type OsrmResponse = {
  code: string;
  routes?: Array<{ geometry: { coordinates: LngLat[] } }>;
};

// Module-level cache keyed by "lng,lat;lng,lat", shared across every mount of
// the dashboard for the lifetime of the page. OSRM is a free public service
// with no key, so we fetch each corridor at most once per page load — never
// per render, never per remount — to stay well clear of its rate limit
// during a live demo. Failures (offline, rate-limited) resolve to `null` and
// are cached too, so the map falls back to plain points instead of retrying.
const cache = new Map<string, Promise<LngLat[] | null>>();

function keyFor(from: RoutePoint, to: RoutePoint) {
  return `${from.lng},${from.lat};${to.lng},${to.lat}`;
}

async function fetchRouteGeometry(from: RoutePoint, to: RoutePoint): Promise<LngLat[] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as OsrmResponse;
    const coordinates = json.routes?.[0]?.geometry.coordinates;
    if (json.code !== "Ok" || !coordinates || coordinates.length < 2) return null;
    return coordinates;
  } catch {
    return null;
  }
}

export function getRouteGeometry(from: RoutePoint, to: RoutePoint): Promise<LngLat[] | null> {
  const key = keyFor(from, to);
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchRouteGeometry(from, to);
    cache.set(key, pending);
  }
  return pending;
}
