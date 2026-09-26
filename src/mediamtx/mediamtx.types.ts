export interface MediaMtxPathConfig {
  source: string;
  sourceOnDemand?: boolean;
  maxReaders?: number;
  runOnInit?: string;
  runOnReady?: string;
  runOnRead?: string;
  record?: boolean;
  [key: string]: unknown;
}

export interface MediaMtxPathInfo {
  name: string;
  conf: MediaMtxPathConfig;
  ready?: boolean;
  readyTime?: string;
  readers?: unknown[];
}

export interface MediaMtxPathsListResponse {
  itemCount: number;
  pageCount: number;
  items: MediaMtxPathInfo[];
}

export interface MediaMtxClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  mockMode?: boolean;
}
