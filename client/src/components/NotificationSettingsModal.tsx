import React, { useState, useEffect } from 'react';
import {
  X,
  Bell,
  Webhook,
  Send,
  Plus,
  Trash2,
  Key,
  ShieldCheck,
  Check,
  AlertCircle,
  Mail,
  Server,
  Lock,
} from 'lucide-react';

export interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'email' | 'whatsapp' | 'webhooks'>('email');

  // SMTP Email Alert State (Core Package 1)
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecurity, setSmtpSecurity] = useState<'starttls' | 'tls' | 'none'>('starttls');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('Basic VMS <alerts@basic-vms.local>');
  const [smtpRecipients, setSmtpRecipients] = useState<string[]>([]);
  const [newRecipientEmail, setNewRecipientEmail] = useState('');
  const [smtpCooldownSeconds, setSmtpCooldownSeconds] = useState(60);
  const [smtpEvents, setSmtpEvents] = useState<string[]>([
    'motion.detected',
    'camera.offline',
    'storage.warning',
  ]);
  const [smtpEnabled, setSmtpEnabled] = useState(true);
  const [smtpHasPassword, setSmtpHasPassword] = useState(false);
  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  // WhatsApp Alert State (Package 2 Extended)
  const [provider, setProvider] = useState<'mock' | 'whatsapp_cloud' | 'twilio'>('mock');
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromPhone, setFromPhone] = useState('');
  const [recipientPhones, setRecipientPhones] = useState<string[]>([]);
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(60);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['motion.detected', 'camera.offline']);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Webhooks State (Package 2 Extended)
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [newWebhookName, setNewWebhookName] = useState('');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(['*']);

  // UI status feedback
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    loadSettings();
  }, [isOpen]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('vms_token') || localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
  };

  const loadSettings = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      // 1. Fetch Built-in SMTP Email Settings (Core)
      try {
        const smtpRes = await fetch('/api/notifications/smtp', { headers: getAuthHeaders() });
        if (smtpRes.ok) {
          const smtpData = await smtpRes.json();
          setSmtpHost(smtpData.host || 'localhost');
          setSmtpPort(smtpData.port || 587);
          if (smtpData.secure) {
            setSmtpSecurity('tls');
          } else if (smtpData.requireTls) {
            setSmtpSecurity('starttls');
          } else {
            setSmtpSecurity('none');
          }
          setSmtpUser(smtpData.user || '');
          setSmtpHasPassword(Boolean(smtpData.hasPassword));
          setSmtpFrom(smtpData.from || 'Basic VMS <alerts@basic-vms.local>');
          setSmtpRecipients(smtpData.recipients || []);
          setSmtpCooldownSeconds(smtpData.cooldownSeconds || 60);
          setSmtpEvents(smtpData.events || ['motion.detected', 'camera.offline', 'storage.warning']);
          setSmtpEnabled(smtpData.enabled ?? true);
        }
      } catch {
        // Safe fallback
      }

      // 2. Fetch WhatsApp Notification Settings (Package 2)
      try {
        const notifRes = await fetch('/api/notifications/settings', { headers: getAuthHeaders() });
        if (notifRes.ok) {
          const notifData = await notifRes.json();
          setProvider(notifData.provider || 'mock');
          setCooldownSeconds(notifData.cooldownSeconds || 60);
          setRecipientPhones(notifData.recipientPhones || []);
          setSelectedEvents(notifData.events || ['motion.detected', 'camera.offline']);
          setNotificationsEnabled(notifData.enabled ?? true);
          if (notifData.sender) setFromPhone(notifData.sender);
        }
      } catch {
        // Gated or offline
      }

      // 3. Fetch Webhooks (Package 2)
      try {
        const whRes = await fetch('/api/webhooks', { headers: getAuthHeaders() });
        if (whRes.ok) {
          const whData = await whRes.json();
          setWebhooks(Array.isArray(whData) ? whData : []);
        }
      } catch {
        // Gated or offline
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Error loading settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSmtp = async () => {
    setStatusMessage(null);
    setLoading(true);
    try {
      const payload: any = {
        host: smtpHost.trim(),
        port: Number(smtpPort),
        secure: smtpSecurity === 'tls',
        requireTls: smtpSecurity === 'starttls',
        user: smtpUser.trim(),
        from: smtpFrom.trim(),
        recipients: smtpRecipients,
        cooldownSeconds: Number(smtpCooldownSeconds),
        events: smtpEvents,
        enabled: smtpEnabled,
      };

      if (smtpPass && smtpPass.trim() !== '') {
        payload.pass = smtpPass;
      }

      const res = await fetch('/api/notifications/smtp', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update SMTP settings');
      }

      setStatusMessage({ type: 'success', text: 'SMTP email alert settings saved successfully' });
      setSmtpPass('');
      setSmtpHasPassword(true);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save SMTP settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    setStatusMessage(null);
    setIsSendingTestEmail(true);
    try {
      const res = await fetch('/api/notifications/smtp/test', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ recipient: testEmailRecipient.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Test email dispatch failed');
      setStatusMessage({ type: 'success', text: 'Test email dispatched successfully! Check recipient inbox.' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to dispatch test email' });
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const handleAddSmtpRecipient = (e: React.FormEvent) => {
    e.preventDefault();
    const email = newRecipientEmail.trim();
    if (!email) return;
    if (!email.includes('@')) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid email address' });
      return;
    }
    if (smtpRecipients.includes(email)) {
      setStatusMessage({ type: 'error', text: 'Email is already in recipient list' });
      return;
    }
    setSmtpRecipients([...smtpRecipients, email]);
    setNewRecipientEmail('');
  };

  const handleRemoveSmtpRecipient = (email: string) => {
    setSmtpRecipients(smtpRecipients.filter((r) => r !== email));
  };

  const handleSaveNotifications = async () => {
    setStatusMessage(null);
    setLoading(true);

    let credentialsJson: string | null = null;
    if (provider === 'whatsapp_cloud') {
      credentialsJson = JSON.stringify({ accessToken, phoneNumberId });
    } else if (provider === 'twilio') {
      credentialsJson = JSON.stringify({ accountSid, authToken, fromPhone });
    }

    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          provider,
          credentialsJson,
          sender: fromPhone || null,
          recipientPhones,
          cooldownSeconds,
          events: selectedEvents,
          enabled: notificationsEnabled,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update settings');
      }

      setStatusMessage({ type: 'success', text: 'Notification settings saved successfully' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestNotification = async () => {
    setStatusMessage(null);
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Test dispatch failed');
      setStatusMessage({ type: 'success', text: 'Test alert sent successfully!' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookName || !newWebhookUrl) return;

    setStatusMessage(null);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newWebhookName,
          url: newWebhookUrl,
          secret: newWebhookSecret || undefined,
          events: newWebhookEvents,
          enabled: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to register webhook');
      }

      setStatusMessage({ type: 'success', text: 'Webhook endpoint registered successfully' });
      setNewWebhookName('');
      setNewWebhookUrl('');
      setNewWebhookSecret('');
      loadSettings();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      const res = await fetch(`/api/webhooks/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete webhook');
      setWebhooks(webhooks.filter((w) => w.id !== id));
      setStatusMessage({ type: 'success', text: 'Webhook deleted' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Webhook ping failed');
      setStatusMessage({
        type: 'success',
        text: `Webhook responded: HTTP ${data.statusCode} (${data.responseTimeMs}ms)`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col w-full max-w-3xl max-h-[90vh] bg-[#090d16] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#111827] border-b border-[#1f2937]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#2563eb]/10 text-[#38bdf8] border border-[#2563eb]/30">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Alerts & Integration Settings</h2>
              <p className="text-xs text-slate-400">
                Configure built-in email alerts (Core), WhatsApp notifications, and HMAC-signed webhooks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2937] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[#1f2937] bg-[#0d131f] px-6">
          <button
            onClick={() => setActiveTab('email')}
            className={`flex items-center gap-2 py-3 px-4 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === 'email'
                ? 'border-[#38bdf8] text-[#38bdf8]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mail className="w-4 h-4" />
            <span>Built-in Email Alerts</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-900/50 text-blue-300 font-semibold border border-blue-700/50">
              Core
            </span>
          </button>
          <button
            onClick={() => setActiveTab('whatsapp')}
            className={`flex items-center gap-2 py-3 px-4 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === 'whatsapp'
                ? 'border-[#10b981] text-[#10b981]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>WhatsApp / SMS Alerts</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 font-semibold border border-emerald-800/50">
              Package 2
            </span>
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`flex items-center gap-2 py-3 px-4 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === 'webhooks'
                ? 'border-[#f59e0b] text-[#f59e0b]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Webhook className="w-4 h-4" />
            <span>Outbound Webhooks</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 font-semibold border border-amber-800/50">
              Package 2
            </span>
          </button>
        </div>

        {/* Feedback alert */}
        {statusMessage && (
          <div
            className={`px-6 py-2.5 flex items-center gap-2 text-xs font-medium ${
              statusMessage.type === 'success'
                ? 'bg-[#10b981]/20 text-[#10b981] border-b border-[#10b981]/30'
                : 'bg-rose-500/20 text-rose-300 border-b border-rose-500/30'
            }`}
          >
            {statusMessage.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Tab contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: BUILT-IN EMAIL ALERTS (CORE) */}
          {activeTab === 'email' && (
            <div className="space-y-5">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-[#111827] border border-[#1f2937]">
                <div>
                  <div className="text-sm font-semibold text-slate-200">Enable SMTP Email Alerting</div>
                  <div className="text-xs text-slate-400">
                    Dispatches formatted incident emails with IST timestamps and playback links
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={smtpEnabled}
                  onChange={(e) => setSmtpEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#38bdf8] cursor-pointer"
                />
              </div>

              {/* SMTP Server Configuration */}
              <div className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                <div className="text-xs font-semibold text-[#38bdf8] flex items-center gap-1.5">
                  <Server className="w-4 h-4" /> SMTP Relay Server
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] text-slate-400 mb-1">Host (e.g. smtp.gmail.com or IP)</label>
                    <input
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#38bdf8]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Port</label>
                    <input
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 587)}
                      placeholder="587"
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#38bdf8]"
                    />
                  </div>
                </div>

                {/* Encryption Security Option */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Encryption Mode</label>
                  <div className="flex gap-4 text-xs text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="smtpSecurity"
                        value="starttls"
                        checked={smtpSecurity === 'starttls'}
                        onChange={() => {
                          setSmtpSecurity('starttls');
                          setSmtpPort(587);
                        }}
                        className="accent-[#38bdf8]"
                      />
                      <span>STARTTLS (Port 587)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="smtpSecurity"
                        value="tls"
                        checked={smtpSecurity === 'tls'}
                        onChange={() => {
                          setSmtpSecurity('tls');
                          setSmtpPort(465);
                        }}
                        className="accent-[#38bdf8]"
                      />
                      <span>Direct SSL/TLS (Port 465)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="smtpSecurity"
                        value="none"
                        checked={smtpSecurity === 'none'}
                        onChange={() => {
                          setSmtpSecurity('none');
                          setSmtpPort(25);
                        }}
                        className="accent-[#38bdf8]"
                      />
                      <span>Plain TCP (Port 25)</span>
                    </label>
                  </div>
                </div>

                {/* Authentication */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#1f2937]">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">SMTP Username / Email</label>
                    <input
                      type="text"
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      placeholder="alerts@domain.com"
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#38bdf8]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Password / App Password {smtpHasPassword && '(Saved)'}
                    </label>
                    <input
                      type="password"
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      placeholder={smtpHasPassword ? '********' : 'Enter SMTP password'}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#38bdf8]"
                    />
                  </div>
                </div>

                {/* From header */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Sender 'From' Name & Address</label>
                  <input
                    type="text"
                    value={smtpFrom}
                    onChange={(e) => setSmtpFrom(e.target.value)}
                    placeholder="Basic VMS <alerts@basic-vms.local>"
                    className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#38bdf8]"
                  />
                </div>
              </div>

              {/* Recipient Emails */}
              <div className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  Recipient Email Addresses
                </label>
                <form onSubmit={handleAddSmtpRecipient} className="flex gap-2">
                  <input
                    type="email"
                    placeholder="security@company.com"
                    value={newRecipientEmail}
                    onChange={(e) => setNewRecipientEmail(e.target.value)}
                    className="flex-1 bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#38bdf8]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-[#38bdf8] hover:bg-[#0284c7] text-slate-950 font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Recipient
                  </button>
                </form>

                {/* Chip list */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {smtpRecipients.map((email) => (
                    <div
                      key={email}
                      className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#090d16] border border-[#1f2937] text-xs font-mono text-slate-300"
                    >
                      <span>{email}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSmtpRecipient(email)}
                        className="text-slate-500 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {smtpRecipients.length === 0 && (
                    <span className="text-xs text-slate-500 italic">No recipient emails added yet.</span>
                  )}
                </div>
              </div>

              {/* Cooldown setting */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Anti-Flood Cooldown Window: <span className="text-[#38bdf8] font-mono">{smtpCooldownSeconds}s</span>
                  </label>
                </div>
                <input
                  type="range"
                  min="10"
                  max="300"
                  step="5"
                  value={smtpCooldownSeconds}
                  onChange={(e) => setSmtpCooldownSeconds(parseInt(e.target.value, 10))}
                  className="w-full accent-[#38bdf8] cursor-pointer"
                />
              </div>

              {/* Events subscription */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Subscribed Alert Events
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                  {['motion.detected', 'camera.offline', 'storage.warning', 'camera.degraded'].map((ev) => (
                    <label key={ev} className="flex items-center gap-2 p-2 rounded bg-[#111827] border border-[#1f2937] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smtpEvents.includes(ev)}
                        onChange={(e) => {
                          if (e.target.checked) setSmtpEvents([...smtpEvents, ev]);
                          else setSmtpEvents(smtpEvents.filter((x) => x !== ev));
                        }}
                        className="accent-[#38bdf8]"
                      />
                      <span className="font-mono text-[11px]">{ev}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  With camera.offline selected, a site whose cameras all go unreachable at once sends one
                  &quot;site unreachable&quot; alert (and one when it is back) instead of an alert per camera.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-[#1f2937]">
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="Test recipient (optional)"
                    value={testEmailRecipient}
                    onChange={(e) => setTestEmailRecipient(e.target.value)}
                    className="w-48 bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:border-[#38bdf8]"
                  />
                  <button
                    type="button"
                    onClick={handleSendTestEmail}
                    disabled={isSendingTestEmail}
                    className="px-3 py-2 rounded-lg bg-[#1f2937] hover:bg-[#374151] text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" /> {isSendingTestEmail ? 'Sending...' : 'Send Test Email'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSaveSmtp}
                  disabled={loading}
                  className="px-5 py-2 rounded-lg bg-[#38bdf8] hover:bg-[#0284c7] text-gray-950 font-bold text-xs flex items-center gap-1.5 transition-colors"
                >
                  Save Email Settings
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: WHATSAPP / SMS ALERTS (PACKAGE 2) */}
          {activeTab === 'whatsapp' && (
            <div className="space-y-5">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-[#111827] border border-[#1f2937]">
                <div>
                  <div className="text-sm font-semibold text-slate-200">Enable Incident Alerting</div>
                  <div className="text-xs text-slate-400">
                    Dispatches real-time alerts to recipient numbers with 60s anti-spam cooldown
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#10b981] cursor-pointer"
                />
              </div>

              {/* Provider select */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Notification Provider
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as any)}
                  className="w-full bg-[#111827] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#10b981]"
                >
                  <option value="mock">Simulated / Mock Dispatcher (In-Memory)</option>
                  <option value="whatsapp_cloud">Meta WhatsApp Business Cloud API</option>
                  <option value="twilio">Twilio WhatsApp API</option>
                </select>
              </div>

              {/* Provider credentials */}
              {provider === 'whatsapp_cloud' && (
                <div className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                  <div className="text-xs font-semibold text-[#10b981] flex items-center gap-1.5">
                    <Key className="w-4 h-4" /> Meta Cloud API Credentials
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Permanent Access Token</label>
                    <input
                      type="password"
                      placeholder="Leave unchanged to preserve existing secret"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#10b981]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Sender Phone Number ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 104829103984920"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#10b981]"
                    />
                  </div>
                </div>
              )}

              {provider === 'twilio' && (
                <div className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                  <div className="text-xs font-semibold text-[#10b981] flex items-center gap-1.5">
                    <Key className="w-4 h-4" /> Twilio Account Credentials
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Account SID</label>
                      <input
                        type="text"
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={accountSid}
                        onChange={(e) => setAccountSid(e.target.value)}
                        className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#10b981]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Auth Token</label>
                      <input
                        type="password"
                        placeholder="Leave unchanged to preserve existing token"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#10b981]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Sender WhatsApp Phone Number</label>
                    <input
                      type="text"
                      placeholder="whatsapp:+14155238886"
                      value={fromPhone}
                      onChange={(e) => setFromPhone(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#10b981]"
                    />
                  </div>
                </div>
              )}

              {/* Recipient numbers */}
              <div className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  Recipient Phone Numbers (E.164 format)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="+919876543210"
                    value={newPhoneInput}
                    onChange={(e) => setNewPhoneInput(e.target.value)}
                    className="flex-1 bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#10b981]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newPhoneInput.trim()) {
                        setRecipientPhones([...recipientPhones, newPhoneInput.trim()]);
                        setNewPhoneInput('');
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-[#10b981] hover:bg-[#059669] text-gray-950 font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                {/* Phone chips */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {recipientPhones.map((phone) => (
                    <div
                      key={phone}
                      className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#090d16] border border-[#1f2937] text-xs font-mono text-slate-300"
                    >
                      <span>{phone}</span>
                      <button
                        type="button"
                        onClick={() => setRecipientPhones(recipientPhones.filter((p) => p !== phone))}
                        className="text-slate-500 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {recipientPhones.length === 0 && (
                    <span className="text-xs text-slate-500 italic">No recipient numbers added.</span>
                  )}
                </div>
              </div>

              {/* Cooldown setting */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Anti-Spam Cooldown Window: <span className="text-[#10b981] font-mono">{cooldownSeconds}s</span>
                  </label>
                </div>
                <input
                  type="range"
                  min="10"
                  max="300"
                  step="5"
                  value={cooldownSeconds}
                  onChange={(e) => setCooldownSeconds(parseInt(e.target.value, 10))}
                  className="w-full accent-[#10b981] cursor-pointer"
                />
              </div>

              {/* Events subscription */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Subscribed Alert Events
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                  {['motion.detected', 'camera.offline', 'camera.degraded', 'camera.tamper'].map((ev) => (
                    <label key={ev} className="flex items-center gap-2 p-2 rounded bg-[#111827] border border-[#1f2937] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(ev)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedEvents([...selectedEvents, ev]);
                          else setSelectedEvents(selectedEvents.filter((x) => x !== ev));
                        }}
                        className="accent-[#10b981]"
                      />
                      <span className="font-mono text-[11px]">{ev}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  With camera.offline selected, a site whose cameras all go unreachable at once sends one
                  &quot;site unreachable&quot; alert (and one when it is back) instead of an alert per camera.
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-[#1f2937]">
                <button
                  type="button"
                  onClick={handleSendTestNotification}
                  disabled={loading || recipientPhones.length === 0}
                  className="px-4 py-2 rounded-lg bg-[#1f2937] hover:bg-[#374151] text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" /> Send Test Alert
                </button>
                <button
                  type="button"
                  onClick={handleSaveNotifications}
                  disabled={loading}
                  className="px-5 py-2 rounded-lg bg-[#10b981] hover:bg-[#059669] text-gray-950 font-bold text-xs flex items-center gap-1.5 transition-colors"
                >
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: OUTBOUND WEBHOOKS (PACKAGE 2) */}
          {activeTab === 'webhooks' && (
            <div className="space-y-6">
              {/* New Webhook Form */}
              <form onSubmit={handleCreateWebhook} className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                <div className="text-xs font-semibold text-[#f59e0b] flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Register New Webhook Endpoint
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Friendly Name</label>
                    <input
                      type="text"
                      placeholder="e.g. SIEM / Discord Alert Gateway"
                      value={newWebhookName}
                      onChange={(e) => setNewWebhookName(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-[#f59e0b]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Target Endpoint URL</label>
                    <input
                      type="url"
                      placeholder="https://webhook.site/..."
                      value={newWebhookUrl}
                      onChange={(e) => setNewWebhookUrl(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#f59e0b]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Shared Secret (Optional - for HMAC-SHA256 signature verification)
                  </label>
                  <input
                    type="password"
                    placeholder="Leave blank to auto-generate secure 32-byte secret"
                    value={newWebhookSecret}
                    onChange={(e) => setNewWebhookSecret(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-[#f59e0b]"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-[#f59e0b] hover:bg-[#d97706] text-gray-950 font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Webhook Endpoint
                  </button>
                </div>
              </form>

              {/* Registered Webhooks List */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-300">Registered Outbound Endpoints</h3>
                {webhooks.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 rounded-lg bg-[#111827] border border-[#1f2937]">
                    No webhooks registered. Add one above to receive signed incident payloads.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {webhooks.map((wh) => (
                      <div
                        key={wh.id}
                        className="flex items-center justify-between p-3.5 rounded-lg bg-[#111827] border border-[#1f2937] text-xs"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-100 flex items-center gap-2">
                            <span>{wh.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#090d16] border border-[#1f2937] text-[#4fc3f7]">
                              {wh.secret}
                            </span>
                          </div>
                          <div className="text-slate-400 font-mono text-[11px] truncate max-w-md">
                            {wh.url}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleTestWebhook(wh.id)}
                            title="Send Test Ping"
                            className="p-1.5 rounded bg-[#1f2937] hover:bg-[#374151] text-slate-300 hover:text-white transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteWebhook(wh.id)}
                            title="Delete Webhook"
                            className="p-1.5 rounded bg-[#1f2937] hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsModal;
