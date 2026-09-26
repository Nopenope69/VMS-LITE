import { useState, useEffect, useCallback, useRef } from 'react';

export type NetworkTier = 'optimal' | 'degraded' | 'choked';

export interface NetworkBandwidthState {
  bandwidthMbps: number;
  latencyMs: number;
  packetLossPercent: number;
  tier: NetworkTier;
  targetFps: number;
  forceSubStream: boolean;
  autoThrottleEnabled: boolean;
  setAutoThrottleEnabled: (enabled: boolean) => void;
  thresholdMbps: number;
  setThresholdMbps: (mbps: number) => void;
  isThrottled: boolean;
  measureNow: () => Promise<void>;
}

export function useNetworkBandwidth(initialThresholdMbps: number = 5): NetworkBandwidthState {
  const [latencyMs, setLatencyMs] = useState<number>(24);
  const [bandwidthMbps, setBandwidthMbps] = useState<number>(18.5);
  const [packetLossPercent, setPacketLossPercent] = useState<number>(0.1);
  const [autoThrottleEnabled, setAutoThrottleEnabled] = useState<boolean>(true);
  const [thresholdMbps, setThresholdMbps] = useState<number>(initialThresholdMbps);
  const isMountedRef = useRef<boolean>(true);

  const measureNow = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/health/ping', { cache: 'no-store' });
      const t1 = performance.now();
      if (!isMountedRef.current) return;

      if (res.ok) {
        const roundTrip = Math.round(t1 - t0);
        setLatencyMs(roundTrip);

        // Derive estimated bandwidth proxy based on RTT stability
        // Under local/LAN (RTT < 40ms) -> 20-30 Mbps
        // Moderate WAN (RTT 50-100ms) -> 8-15 Mbps
        // High latency / congested WAN (RTT > 120ms) -> 2-4 Mbps
        let estMbps = 22.4;
        if (roundTrip > 150) {
          estMbps = Math.max(1.8, Math.round((400 / roundTrip) * 10) / 10);
        } else if (roundTrip > 60) {
          estMbps = Math.round((900 / roundTrip) * 10) / 10;
        } else {
          estMbps = Math.min(48, Math.round((1200 / Math.max(roundTrip, 10)) * 10) / 10);
        }

        setBandwidthMbps(estMbps);
        setPacketLossPercent(roundTrip > 160 ? 6.2 : roundTrip > 80 ? 1.8 : 0.0);
      }
    } catch {
      if (isMountedRef.current) {
        setLatencyMs(320);
        setBandwidthMbps(2.1);
        setPacketLossPercent(12.5);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    measureNow();
    const timer = setInterval(measureNow, 12000);
    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [measureNow]);

  // Determine network tier
  let tier: NetworkTier = 'optimal';
  if (bandwidthMbps < thresholdMbps || latencyMs > 160 || packetLossPercent > 5) {
    tier = 'choked';
  } else if (bandwidthMbps < thresholdMbps * 2 || latencyMs > 70) {
    tier = 'degraded';
  }

  const isThrottled = autoThrottleEnabled && tier === 'choked';
  const targetFps = isThrottled ? 10 : tier === 'degraded' ? 15 : 25;
  const forceSubStream = isThrottled || (autoThrottleEnabled && tier === 'degraded');

  return {
    bandwidthMbps,
    latencyMs,
    packetLossPercent,
    tier,
    targetFps,
    forceSubStream,
    autoThrottleEnabled,
    setAutoThrottleEnabled,
    thresholdMbps,
    setThresholdMbps,
    isThrottled,
    measureNow,
  };
}
