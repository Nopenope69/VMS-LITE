export interface CameraMapMarker {
  cameraId: string;
  cameraName?: string;
  x: number; // 0.0 to 100.0 (percentage across width)
  y: number; // 0.0 to 100.0 (percentage across height)
  angle: number; // 0 to 360 degrees (0 = North/Up, 90 = East, 180 = South, 270 = West)
  fovDegrees?: number; // e.g. 60 to 120 degrees
}

export interface FloorPlanDto {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  widthMeters?: number;
  heightMeters?: number;
  markers: CameraMapMarker[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateFloorPlanInput {
  name: string;
  description?: string;
  imageUrl?: string;
  widthMeters?: number;
  heightMeters?: number;
  markers?: CameraMapMarker[];
}

export interface UpdateFloorPlanInput {
  name?: string;
  description?: string;
  imageUrl?: string;
  widthMeters?: number;
  heightMeters?: number;
  markers?: CameraMapMarker[];
}
