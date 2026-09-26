export interface VmsLocation {
  id: string;
  name: string;
  code?: string;
  icon?: string;
  cameraIds: string[];
  isDefault?: boolean;
}

export interface VmsZone {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  cameraIds: string[];
}

export interface LocationConfigData {
  locations: VmsLocation[];
  zones: VmsZone[];
}
