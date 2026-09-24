export type SimulatedAlertType = "THEFT" | "LEAK" | "POTHOLE_OR_SLOSH" | "UNKNOWN";

export type SimulatedAlert = {
  type: SimulatedAlertType;
  confidence: number;
  reason: string;
  dropAmount: number;
};

export type FleetVehicleDef = {
  /** Stable client-side key; also used to look up the real Vehicle row by label. */
  label: string;
  lat: number;
  lng: number;
  highway: string;
  /** References a RouteDef id in fleet-routes.ts. */
  routeId: string;
  /**
   * Only for vehicles with no backing DB row (dbId === null): a hardcoded
   * alert so the map shows a mix of green/red instead of an all-green demo
   * fleet. Clearly labeled "simulated" in the UI — never presented as a real
   * detection.
   */
  simulatedAlert?: SimulatedAlert;
};

/**
 * Hardcoded fleet positions for the demo. Coordinates sit on real towns along
 * existing Mexican highways so markers land on the road, not in open terrain.
 * "Truck-01" is the only vehicle seeded in Neon; the rest resolve to null and
 * render as demo-only markers with no historical data (some carry a
 * simulatedAlert purely for visual variety).
 */
export const FLEET_VEHICLES: FleetVehicleDef[] = [
  {
    label: "Truck-01",
    lat: 25.6733,
    lng: -100.4589,
    highway: "Autopista 40D · Monterrey–Saltillo (Santa Catarina, NL)",
    routeId: "mty-saltillo",
  },
  {
    label: "Truck-02",
    lat: 25.5478,
    lng: -100.9439,
    highway: "Autopista 40D · Monterrey–Saltillo (Ramos Arizpe, Coah.)",
    routeId: "mty-saltillo",
  },
  {
    label: "Truck-03",
    lat: 25.3833,
    lng: -101.4667,
    highway: "Carretera Federal 40 · Saltillo–Torreón (General Cepeda, Coah.)",
    routeId: "saltillo-torreon",
    simulatedAlert: {
      type: "LEAK",
      confidence: 0.58,
      reason:
        "Descenso gradual y sostenido de combustible durante 40 minutos sin recuperación, consistente con una fuga lenta.",
      dropAmount: 6.4,
    },
  },
  {
    label: "Truck-04",
    lat: 20.3866,
    lng: -99.9962,
    highway: "Autopista 57D · Querétaro–CDMX (San Juan del Río, Qro.)",
    routeId: "cdmx-queretaro",
  },
  {
    label: "Truck-05",
    lat: 19.7139,
    lng: -99.2278,
    highway: "Autopista 57D · Querétaro–CDMX (Tepotzotlán, Edo. Méx.)",
    routeId: "cdmx-queretaro",
  },
  {
    label: "Truck-06",
    lat: 18.85,
    lng: -97.1,
    highway: "Autopista 150D · Puebla–Veracruz (Orizaba, Ver.)",
    routeId: "puebla-veracruz",
  },
  {
    label: "Truck-07",
    lat: 19.6961,
    lng: -103.4681,
    highway: "Autopista 54D · Guadalajara–Colima (Ciudad Guzmán, Jal.)",
    routeId: "gdl-colima",
    simulatedAlert: {
      type: "THEFT",
      confidence: 0.87,
      reason:
        "Caída abrupta de combustible con el vehículo detenido y sin recuperación posterior, consistente con extracción no autorizada.",
      dropAmount: 22.5,
    },
  },
  {
    label: "Truck-08",
    lat: 18.9083,
    lng: -103.8739,
    highway: "Autopista 54D · Guadalajara–Colima (Tecomán, Col.)",
    routeId: "gdl-colima",
  },
  {
    label: "Truck-09",
    lat: 32.5322,
    lng: -116.0678,
    highway: "Carretera Federal 2D · Tijuana–Mexicali (La Rumorosa, B.C.)",
    routeId: "tijuana-mexicali",
  },
];
