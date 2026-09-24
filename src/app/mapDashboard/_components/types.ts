import type { FleetVehicleDef, SimulatedAlertType } from "../data/fleet-vehicles";
import type { LngLat } from "../data/route-cache";

export type MapVehicle = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  hasAlert: boolean;
};

export type MapRoute = {
  id: string;
  positions: LngLat[];
};

export type SelectedVehicle = FleetVehicleDef & {
  id: string;
  dbId: string | null;
  hasAlert: boolean;
};

/** A real DB-backed alert or a hardcoded demo one, normalized for display. */
export type DisplayAlert = {
  id: string;
  type: SimulatedAlertType;
  confidence: number;
  reason: string;
  dropAmount: number;
  simulated: boolean;
};
