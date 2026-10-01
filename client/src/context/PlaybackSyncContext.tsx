import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';

export interface AlignmentInput {
  segmentStartMs: number;
  currentTimeSec: number;
  targetTimestampMs: number;
  toleranceMs?: number;
}

export interface AlignmentResult {
  playerAbsoluteMs: number;
  skewMs: number;
  needsReseek: boolean;
  suggestedSeekSec: number;
}

/**
 * Calculates skew and determines whether a playback stream needs to reseek
 * to align with the master UTC target timestamp.
 */
export function calculatePlayerAlignment(input: AlignmentInput): AlignmentResult {
  const tolerance = input.toleranceMs ?? 200;
  const playerAbsoluteMs = input.segmentStartMs + input.currentTimeSec * 1000;
  const skewMs = Math.round(Math.abs(playerAbsoluteMs - input.targetTimestampMs));
  const needsReseek = skewMs > tolerance;
  const suggestedSeekSec = Math.max(0, (input.targetTimestampMs - input.segmentStartMs) / 1000);

  return {
    playerAbsoluteMs,
    skewMs,
    needsReseek,
    suggestedSeekSec,
  };
}

export interface PlayerState {
  isBuffering: boolean;
  currentTimeSec: number;
  segmentStartMs: number;
  registeredAt: number;
}

export interface PlaybackSyncContextType {
  targetTimestampMs: number;
  targetTimestampUtc: number;
  isPlaying: boolean;
  playbackRate: number;
  isBuffering: boolean;
  selectedCameraIds: string[];
  decodeBudgetWarning: string | null;
  toleranceMs: number;
  seekToTimestamp: (utcMs: number) => void;
  setIsPlaying: (playing: boolean | ((prev: boolean) => boolean)) => void;
  setPlaybackRate: (rate: number) => void;
  setSelectedCameraIds: (ids: string[]) => void;
  toggleCameraSelection: (cameraId: string) => boolean;
  clearDecodeBudgetWarning: () => void;
  registerPlayer: (cameraId: string) => void;
  unregisterPlayer: (cameraId: string) => void;
  reportBuffering: (cameraId: string, isBuffering: boolean) => void;
  reportPlayerTime: (cameraId: string, currentTimeSec: number, segmentStartMs: number) => void;
  playerStates: Record<string, PlayerState>;
}

export const PlaybackSyncContext = createContext<PlaybackSyncContextType | undefined>(undefined);

export interface PlaybackSyncProviderProps {
  children: ReactNode;
  initialTimestampMs?: number;
  initialCameraIds?: string[];
  maxCameras?: number;
  toleranceMs?: number;
}

export const PlaybackSyncProvider: React.FC<PlaybackSyncProviderProps> = ({
  children,
  initialTimestampMs,
  initialCameraIds = [],
  maxCameras = 4,
  toleranceMs = 200,
}) => {
  const [targetTimestampMs, setTargetTimestampMs] = useState<number>(() => {
    return initialTimestampMs ?? Date.now();
  });
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [selectedCameraIds, setSelectedCameraIdsState] = useState<string[]>(() => {
    return initialCameraIds.slice(0, maxCameras);
  });
  const [decodeBudgetWarning, setDecodeBudgetWarning] = useState<string | null>(null);
  const [playerStates, setPlayerStates] = useState<Record<string, PlayerState>>({});

  // Compute stall lock: if any selected camera's player is actively buffering
  const isBuffering = useMemo(() => {
    if (selectedCameraIds.length === 0) return false;
    return selectedCameraIds.some((id) => playerStates[id]?.isBuffering === true);
  }, [selectedCameraIds, playerStates]);

  const clearDecodeBudgetWarning = useCallback(() => {
    setDecodeBudgetWarning(null);
  }, []);

  const setSelectedCameraIds = useCallback(
    (ids: string[]) => {
      if (ids.length > maxCameras) {
        setDecodeBudgetWarning(
          `Decode budget limit reached: Maximum ${maxCameras} simultaneous playback cameras allowed.`
        );
        setSelectedCameraIdsState(ids.slice(0, maxCameras));
      } else {
        setDecodeBudgetWarning(null);
        setSelectedCameraIdsState(ids);
      }
    },
    [maxCameras]
  );

  const toggleCameraSelection = useCallback(
    (cameraId: string): boolean => {
      if (selectedCameraIds.includes(cameraId)) {
        setSelectedCameraIdsState((prev) => prev.filter((id) => id !== cameraId));
        setDecodeBudgetWarning(null);
        return true;
      }

      if (selectedCameraIds.length >= maxCameras) {
        setDecodeBudgetWarning(
          `Decode budget limit reached: Maximum ${maxCameras} simultaneous playback cameras allowed.`
        );
        return false;
      }

      setSelectedCameraIdsState((prev) => [...prev, cameraId]);
      setDecodeBudgetWarning(null);
      return true;
    },
    [selectedCameraIds, maxCameras]
  );

  const registerPlayer = useCallback((cameraId: string) => {
    setPlayerStates((prev) => {
      if (prev[cameraId]) return prev;
      return {
        ...prev,
        [cameraId]: {
          isBuffering: false,
          currentTimeSec: 0,
          segmentStartMs: 0,
          registeredAt: Date.now(),
        },
      };
    });
  }, []);

  const unregisterPlayer = useCallback((cameraId: string) => {
    setPlayerStates((prev) => {
      if (!prev[cameraId]) return prev;
      const next = { ...prev };
      delete next[cameraId];
      return next;
    });
  }, []);

  const reportBuffering = useCallback((cameraId: string, buffering: boolean) => {
    setPlayerStates((prev) => {
      const current = prev[cameraId];
      if (current && current.isBuffering === buffering) return prev;
      return {
        ...prev,
        [cameraId]: {
          ...(current || {
            currentTimeSec: 0,
            segmentStartMs: 0,
            registeredAt: Date.now(),
          }),
          isBuffering: buffering,
        },
      };
    });
  }, []);

  const reportPlayerTime = useCallback(
    (cameraId: string, currentTimeSec: number, segmentStartMs: number) => {
      setPlayerStates((prev) => {
        const current = prev[cameraId];
        if (
          current &&
          current.currentTimeSec === currentTimeSec &&
          current.segmentStartMs === segmentStartMs
        ) {
          return prev;
        }
        return {
          ...prev,
          [cameraId]: {
            ...(current || {
              isBuffering: false,
              registeredAt: Date.now(),
            }),
            currentTimeSec,
            segmentStartMs,
          },
        };
      });
    },
    []
  );

  const seekToTimestamp = useCallback((utcMs: number) => {
    setTargetTimestampMs(utcMs);
  }, []);

  // Master Clock advancement ticker: Advances targetTimestampMs when playing and not stall-locked
  const lastTickTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying || isBuffering) {
      lastTickTimeRef.current = null;
      return;
    }

    let animId: number;

    const tick = (now: number) => {
      if (lastTickTimeRef.current !== null) {
        const deltaMs = now - lastTickTimeRef.current;
        if (deltaMs > 0 && deltaMs < 1000) {
          const advanceMs = deltaMs * playbackRate;
          setTargetTimestampMs((prev) => prev + advanceMs);
        }
      }
      lastTickTimeRef.current = now;
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animId);
      lastTickTimeRef.current = null;
    };
  }, [isPlaying, isBuffering, playbackRate]);

  const value: PlaybackSyncContextType = useMemo(
    () => ({
      targetTimestampMs,
      targetTimestampUtc: targetTimestampMs,
      isPlaying,
      playbackRate,
      isBuffering,
      selectedCameraIds,
      decodeBudgetWarning,
      toleranceMs,
      seekToTimestamp,
      setIsPlaying,
      setPlaybackRate,
      setSelectedCameraIds,
      toggleCameraSelection,
      clearDecodeBudgetWarning,
      registerPlayer,
      unregisterPlayer,
      reportBuffering,
      reportPlayerTime,
      playerStates,
    }),
    [
      targetTimestampMs,
      isPlaying,
      playbackRate,
      isBuffering,
      selectedCameraIds,
      decodeBudgetWarning,
      toleranceMs,
      seekToTimestamp,
      setSelectedCameraIds,
      toggleCameraSelection,
      clearDecodeBudgetWarning,
      registerPlayer,
      unregisterPlayer,
      reportBuffering,
      reportPlayerTime,
      playerStates,
    ]
  );

  return <PlaybackSyncContext.Provider value={value}>{children}</PlaybackSyncContext.Provider>;
};

export const usePlaybackSync = (): PlaybackSyncContextType => {
  const context = useContext(PlaybackSyncContext);
  if (!context) {
    throw new Error('usePlaybackSync must be used within a PlaybackSyncProvider');
  }
  return context;
};

export default PlaybackSyncContext;
