import React, { useState, useEffect } from 'react';
import { X, Bell, Webhook, Send, Plus, Trash2, Key, ShieldCheck, Check, AlertCircle } from 'lucide-react';

export interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'whatsapp' | 'webhooks'>('whatsapp');

  // WhatsApp Alert State
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

  // Webhooks State
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
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
  };

  const loadSettings = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      // 1. Fetch Notification Settings
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

      // 2. Fetch Webhooks
      const whRes = await fetch('/api/webhooks', { headers: getAuthHeaders() });
      if (whRes.ok) {
        const whData = await whRes.json();
        setWebhooks(Array.isArray(whData) ? whData : []);
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Error loading settings' });
    } finally {
      setLoading(false);
    }
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
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create webhook');
      }

      setNewWebhookName('');
      setNewWebhookUrl('');
      setNewWebhookSecret('');
      await loadSettings();
      setStatusMessage({ type: 'success', text: 'Webhook endpoint registered successfully' });
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
      if (res.ok) {
        setWebhooks(webhooks.filter((w) => w.id !== id));
        setStatusMessage({ type: 'success', text: 'Webhook deleted' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Failed to delete webhook' });
    }
  };

  const handleTestWebhook = async (id: string) => {
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Test failed');
      setStatusMessage({ type: 'success', text: `Test ping delivered! (HTTP ${data.status || 200})` });
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
            <div className="p-2 rounded-lg bg-[#4fc3f7]/10 text-[#4fc3f7] border border-[#4fc3f7]/30">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Alerts & Integration Settings</h2>
              <p className="text-xs text-slate-400">
                Configure rate-limited WhatsApp notifications and HMAC-signed webhooks
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
            onClick={() => setActiveTab('whatsapp')}
            className={`flex items-center gap-2 py-3 px-4 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === 'whatsapp'
                ? 'border-[#10b981] text-[#10b981]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>WhatsApp / SMS Alerts</span>
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`flex items-center gap-2 py-3 px-4 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === 'webhooks'
                ? 'border-[#4fc3f7] text-[#4fc3f7]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Webhook className="w-4 h-4" />
            <span>Outbound Webhooks</span>
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
          {activeTab === 'whatsapp' ? (
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
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Phone Number ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 104829104829104"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                    />
                  </div>
                </div>
              )}

              {provider === 'twilio' && (
                <div className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                  <div className="text-xs font-semibold text-[#10b981] flex items-center gap-1.5">
                    <Key className="w-4 h-4" /> Twilio WhatsApp Credentials
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Account SID</label>
                      <input
                        type="text"
                        placeholder="AC..."
                        value={accountSid}
                        onChange={(e) => setAccountSid(e.target.value)}
                        className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Auth Token</label>
                      <input
                        type="password"
                        placeholder="Leave unchanged to preserve"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Twilio WhatsApp Sender</label>
                    <input
                      type="text"
                      placeholder="e.g. +14155238886"
                      value={fromPhone}
                      onChange={(e) => setFromPhone(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                    />
                  </div>
                </div>
              )}

              {/* Recipient phone numbers */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Recipient Phone Numbers (E.164 e.g. +919876543210)
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="+91..."
                    value={newPhoneInput}
                    onChange={(e) => setNewPhoneInput(e.target.value)}
                    className="flex-1 bg-[#111827] border border-[#1f2937] text-slate-200 text-xs rounded-lg px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newPhoneInput.trim() && !recipientPhones.includes(newPhoneInput.trim())) {
                        setRecipientPhones([...recipientPhones, newPhoneInput.trim()]);
                        setNewPhoneInput('');
                      }
                    }}
                    className="px-3 py-2 bg-[#1f2937] hover:bg-[#374151] text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recipientPhones.map((phone) => (
                    <span
                      key={phone}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#111827] text-slate-200 text-xs font-mono border border-[#1f2937]"
                    >
                      {phone}
                      <button
                        type="button"
                        onClick={() => setRecipientPhones(recipientPhones.filter((p) => p !== phone))}
                        className="text-slate-400 hover:text-rose-400 ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
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
          ) : (
            <div className="space-y-6">
              {/* New Webhook Form */}
              <form onSubmit={handleCreateWebhook} className="p-4 rounded-lg bg-[#111827] border border-[#1f2937] space-y-3">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-[#4fc3f7]" /> Register New Outbound Webhook
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Endpoint Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Barrier Gate Controller"
                      value={newWebhookName}
                      onChange={(e) => setNewWebhookName(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Destination URL (HTTP/HTTPS)</label>
                    <input
                      type="url"
                      placeholder="https://api.accesscontrol.local/hooks"
                      value={newWebhookUrl}
                      onChange={(e) => setNewWebhookUrl(e.target.value)}
                      className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Shared HMAC Secret (Optional - Auto-generated if blank)</label>
                  <input
                    type="password"
                    placeholder="whsec_..."
                    value={newWebhookSecret}
                    onChange={(e) => setNewWebhookSecret(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#1f2937] text-slate-200 text-xs rounded px-3 py-2"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#4fc3f7] hover:bg-[#38bdf8] text-gray-950 font-bold text-xs rounded-lg transition-colors"
                >
                  Create Webhook Endpoint
                </button>
              </form>

              {/* Webhooks list */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 mb-3">Active Webhook Endpoints</h3>
                {webhooks.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-[#1f2937] rounded-lg">
                    No webhook endpoints configured. Add one above to integrate with barrier gates or sirens.
                  </div>
                ) : (
                  <div className="space-y-3">
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
