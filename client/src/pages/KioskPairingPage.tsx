import React, { useState, useEffect } from 'react';
import { Tv, Shield, RefreshCw, CheckCircle2 } from 'lucide-react';

export interface KioskPairingPageProps {
  onPaired: (stationKey: string) => void;
}

export const KioskPairingPage: React.FC<KioskPairingPageProps> = ({ onPaired }) => {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [stationKey, setStationKey] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch new pairing PIN from server
  const fetchNewCode = async () => {
    try {
      setError(null);
      const res = await fetch('/api/kiosk/pair-code', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setPairingCode(data.code);
        setStationKey(data.stationKey);
      }
    } catch {
      setError('Cannot connect to VMS Server. Check Ethernet/Wi-Fi connection.');
    }
  };

  useEffect(() => {
    fetchNewCode();
  }, []);

  // 2. Poll until Admin enters the PIN
  useEffect(() => {
    if (!stationKey) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/kiosk/station/${stationKey}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.station) {
            clearInterval(interval);
            setIsWaiting(false);
            localStorage.setItem('vms_kiosk_station_key', stationKey);
            setTimeout(() => {
              onPaired(stationKey);
            }, 1500);
          }
        }
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [stationKey, onPaired]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#090d16] text-slate-100 p-8 select-none">
      <div className="w-full max-w-xl bg-[#111827] border border-[#1f2937] rounded-2xl p-10 shadow-2xl flex flex-col items-center text-center">
        {/* TV Icon */}
        <div className="w-16 h-16 rounded-2xl bg-[#4fc3f7]/15 border border-[#4fc3f7]/40 flex items-center justify-center glow-ion mb-6">
          <Tv className="w-8 h-8 text-[#4fc3f7]" />
        </div>

        <h1 className="text-2xl font-extrabold tracking-wider text-slate-100 font-mono mb-2">
          PAIR DISPLAY TV
        </h1>
        <p className="text-sm text-slate-400 mb-8 max-w-md">
          Enter this 4-digit code in the VMS Admin Console under <strong className="text-slate-200">"Display Stations"</strong> to link this screen.
        </p>

        {error ? (
          <div className="p-4 bg-red-950/60 border border-red-500/50 rounded-xl text-xs text-red-200 mb-6">
            {error}
            <button
              onClick={fetchNewCode}
              className="mt-3 block mx-auto px-4 py-1.5 bg-[#4fc3f7] text-[#090d16] font-bold rounded-lg text-xs"
            >
              Retry Connection
            </button>
          </div>
        ) : isWaiting ? (
          <>
            {/* 4-Digit Code Display */}
            <div className="flex items-center gap-4 mb-8">
              {pairingCode ? (
                pairingCode.split('').map((digit, idx) => (
                  <div
                    key={idx}
                    className="w-16 h-20 bg-[#090d16] border-2 border-[#4fc3f7] rounded-xl flex items-center justify-center font-mono text-4xl font-extrabold text-[#4fc3f7] shadow-lg glow-ion"
                  >
                    {digit}
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-slate-400 font-mono text-sm py-6">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#4fc3f7]" />
                  <span>Requesting Pairing PIN...</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Waiting for administrator confirmation...</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-emerald-400">
            <CheckCircle2 className="w-16 h-16 animate-bounce" />
            <span className="text-lg font-bold font-mono">SCREEN PAIRED SUCCESSFULLY!</span>
            <span className="text-xs text-slate-400">Launching security tour...</span>
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-[#1f2937] w-full flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span>Zero-Touch Auto Login</span>
          <span>Fail-Safe Power Recovery</span>
        </div>
      </div>
    </div>
  );
};

export default KioskPairingPage;
