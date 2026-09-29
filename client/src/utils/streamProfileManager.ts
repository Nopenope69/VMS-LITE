export type ViewMode = 'GRID' | 'FOCUSED' | 'FULLSCREEN';
export type QualityOverride = 'AUTO' | 'SD' | 'HD';

export interface ResolveStreamProfileInput {
  viewMode: ViewMode;
  operatorOverride: QualityOverride;
  mainPath: string;
  subPath?: string | null;
}

export interface StreamProfileResolution {
  selectedStream: 'MAIN' | 'SUB';
  path: string;
  isHdOnly: boolean;
}

export function resolveStreamProfile(input: ResolveStreamProfileInput): StreamProfileResolution {
  const hasSub = Boolean(input.subPath && input.subPath.trim().length > 0);

  if (!hasSub) {
    return {
      selectedStream: 'MAIN',
      path: input.mainPath,
      isHdOnly: true,
    };
  }

  if (input.operatorOverride === 'HD') {
    return { selectedStream: 'MAIN', path: input.mainPath, isHdOnly: false };
  }

  if (input.operatorOverride === 'SD') {
    return { selectedStream: 'SUB', path: input.subPath!, isHdOnly: false };
  }

  // AUTO mode: GRID -> SUB, FOCUSED/FULLSCREEN -> MAIN
  const selectedStream = input.viewMode === 'GRID' ? 'SUB' : 'MAIN';
  return {
    selectedStream,
    path: selectedStream === 'SUB' ? input.subPath! : input.mainPath,
    isHdOnly: false,
  };
}
