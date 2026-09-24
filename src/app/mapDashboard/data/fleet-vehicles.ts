export type FleetVehicleDef = {
  /** Stable client-side key; also used to look up the real Vehicle row by label. */
  label: string;
  lat: number;
  lng: number;
  highway: string;
};

/**
 * Hardcoded fleet positions for the demo. Coordinates sit on real towns along
 * existing Mexican highways so markers land on the road, not in open terrain.
 * "Truck-01" is the only vehicle seeded in Neon; the rest resolve to null and
 * render as demo-only markers with no historical data.
 */
export const FLEET_VEHICLES: FleetVehicleDef[] = [
  {
    label: "Truck-01",
    lat: 25.6733,
    lng: -100.4589,
    highway: "Autopista 40D · Monterrey–Saltillo (Santa Catarina, NL)",
  },
  {
    label: "Truck-02",
    lat: 25.5478,
    lng: -100.9439,
    highway: "Autopista 40D · Monterrey–Saltillo (Ramos Arizpe, Coah.)",
  },
  {
    label: "Truck-03",
    lat: 25.3833,
    lng: -101.4667,
    highway: "Carretera Federal 40 · Saltillo–Torreón (General Cepeda, Coah.)",
  },
  {
    label: "Truck-04",
    lat: 20.3866,
    lng: -99.9962,
    highway: "Autopista 57D · Querétaro–CDMX (San Juan del Río, Qro.)",
  },
  {
    label: "Truck-05",
    lat: 19.7139,
    lng: -99.2278,
    highway: "Autopista 57D · Querétaro–CDMX (Tepotzotlán, Edo. Méx.)",
  },
];
