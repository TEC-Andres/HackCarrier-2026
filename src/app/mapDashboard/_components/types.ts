import type { FleetVehicleDef } from "../data/fleet-vehicles";

export type MapVehicle = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  hasAlert: boolean;
};

export type SelectedVehicle = FleetVehicleDef & {
  id: string;
  dbId: string | null;
  hasAlert: boolean;
};
