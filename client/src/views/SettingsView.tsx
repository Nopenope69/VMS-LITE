import React from 'react';
import {
  Sliders,
  Bell,
  Users,
  FileText,
  Database,
  Shield,
  Key,
  HardDrive,
  Cpu,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { AccountSecurityCard } from '../components/AccountSecurityCard.js';

export interface SettingsViewProps {
  isAdmin?: boolean;
  onOpenOperationalSettings: () => void;
  onOpenNotificationSettings: () => void;
  onOpenUserManagement: () => void;
  onOpenAuditLogs: () => void;
  onOpenBackupRestore: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isAdmin = true,
  onOpenOperationalSettings,
  onOpenNotificationSettings,
  onOpenUserManagement,
  onOpenAuditLogs,
  onOpenBackupRestore,
}) => {
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-6 py-8 md:py-10 flex flex-col font-sans select-none overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="text-xs text-zinc-500 mt-1 font-mono">
          System Configuration & Administrative Controls
        </p>
      </div>

      {/* Settings Grid */}
      <div className="space-y-6">
        <AccountSecurityCard />

        {/* Core Configuration Group */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Core Operations
          </h2>
          <div className="space-y-2">
            {/* Storage & Retention */}
            <div
              onClick={onOpenOperationalSettings}
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                    Storage & Retention Policy
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Configure continuous recording retention days, pre/post motion buffer, and auto-pruning.
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Notifications */}
            <div
              onClick={onOpenNotificationSettings}
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                    Alerts & Dispatchers
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Manage real-time notifications for Telegram, Webhooks, Email, and quiet hours.
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>
        </div>

        {/* Security & Access Group */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Security & Compliance
          </h2>
          <div className="space-y-2">
            {/* User Management */}
            <div
              onClick={onOpenUserManagement}
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                    User Accounts & Roles
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Manage operator and administrator credentials, password policies, and camera scopes.
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Audit Logs */}
            <div
              onClick={onOpenAuditLogs}
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                    Audit Log
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Inspect immutable access records, login attempts, configuration changes, and clip exports.
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Backup & Restore */}
            <div
              onClick={onOpenBackupRestore}
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                    Backup & Disaster Recovery
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Download encrypted configuration snapshots and restore database state.
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>
        </div>

        {/* System & Entitlements Info */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            System Information
          </h2>
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Software Edition</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">VMS-LITE Core (Evaluation)</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Active
                </span>
              </div>
            </div>

            <div className="h-px bg-white/[0.04]" />

            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Entitlement Mode</span>
              <span className="text-zinc-300 font-mono text-[11px]">Clean Ed25519 Node Licensing</span>
            </div>

            <div className="h-px bg-white/[0.04]" />

            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Media Engine</span>
              <span className="text-zinc-300 font-mono text-[11px]">MediaMTX v1.11 (Zero-Transcode fMP4)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
