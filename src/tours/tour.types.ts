export type TourLayoutMode = '1+4' | '2+6' | '4+8' | 'quad-zone' | 'matrix';

export interface CameraZoneDto {
  id: string;
  name: string;
  description?: string;
  cameraIds: string[];
  createdAt: string;
}

export interface GuardTourDto {
  id: string;
  name: string;
  layoutMode: TourLayoutMode;
  dwellSeconds: number;
  heroCameraIds: string[];
  carouselPoolIds: string[];
  alarmOverride: boolean;
  zoneId?: string;
  assignedScreen?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTourDto {
  name: string;
  layoutMode?: TourLayoutMode;
  dwellSeconds?: number;
  heroCameraIds: string[];
  carouselPoolIds: string[];
  alarmOverride?: boolean;
  zoneId?: string;
  assignedScreen?: number;
}
