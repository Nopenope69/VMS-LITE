export type KioskDisplayMode = 'DEDICATED' | 'QUAD_ZONE';

export interface DisplayStationDto {
  id: string;
  stationKey: string;
  name: string;
  pairingCode: string | null;
  assignedTourId: string | null;
  mode: KioskDisplayMode;
  isOnline: boolean;
  lastHeartbeat: string;
  createdAt: string;
}

export interface PairStationDto {
  pairingCode: string;
  name: string;
  assignedTourId?: string;
  mode?: KioskDisplayMode;
}
