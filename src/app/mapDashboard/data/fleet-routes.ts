export type RoutePoint = { lat: number; lng: number; label: string };

export type RouteDef = {
  id: string;
  from: RoutePoint;
  to: RoutePoint;
};

/**
 * Real highway corridors the demo fleet drives on. Each is resolved to an
 * actual road geometry once via OSRM (see route-cache.ts) and drawn as a
 * polyline under the vehicle markers.
 */
export const ROUTES: RouteDef[] = [
  {
    id: "mty-saltillo",
    from: { lat: 25.6866, lng: -100.3161, label: "Monterrey" },
    to: { lat: 25.426, lng: -100.9959, label: "Saltillo" },
  },
  {
    id: "saltillo-torreon",
    from: { lat: 25.426, lng: -100.9959, label: "Saltillo" },
    to: { lat: 25.5428, lng: -103.4068, label: "Torreón" },
  },
  {
    id: "cdmx-queretaro",
    from: { lat: 19.4326, lng: -99.1332, label: "CDMX" },
    to: { lat: 20.5888, lng: -100.3899, label: "Querétaro" },
  },
  {
    id: "puebla-veracruz",
    from: { lat: 19.0414, lng: -98.2063, label: "Puebla" },
    to: { lat: 19.1738, lng: -96.1342, label: "Veracruz" },
  },
  {
    id: "gdl-colima",
    from: { lat: 20.6597, lng: -103.3496, label: "Guadalajara" },
    to: { lat: 19.2452, lng: -103.7241, label: "Colima" },
  },
  {
    id: "tijuana-mexicali",
    from: { lat: 32.5149, lng: -117.0382, label: "Tijuana" },
    to: { lat: 32.6245, lng: -115.4523, label: "Mexicali" },
  },
];
