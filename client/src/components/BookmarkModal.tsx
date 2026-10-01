import React, { useState } from 'react';
import {
  X,
  Bookmark,
  AlertTriangle,
  Loader2,
  Calendar,
  Clock,
  Tag,
  Check,
} from 'lucide-react';

export interface BookmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  cameraId: string;
  cameraName?: string;
  timestamp: Date;
  apiBaseUrl?: string;
  authToken?: string;
}

export const BookmarkModal: React.FC<BookmarkModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  cameraId,
  cameraName,
  timestamp,
  apiBaseUrl = '',
  authToken = '',
}) => {
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<string>('incident');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Bookmark title is required');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${apiBaseUrl}/api/cameras/${cameraId}/bookmarks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          timestamp: timestamp.toISOString(),
          title: title.trim(),
          category,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to save bookmark');
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error saving bookmark');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="w-full max-w-md alert-glass border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] glass-bar">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Add Timeline Bookmark</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Timestamp Indicator */}
          <div className="flex items-center gap-3 p-2.5 hud-chip rounded-lg text-xs text-zinc-300 font-mono">
            <Clock className="w-4 h-4 text-emerald-400" />
            <div>
              <span className="text-zinc-500 text-[10px] uppercase block font-sans">Timestamp</span>
              <span className="font-semibold text-zinc-200">{timestamp.toLocaleString()}</span>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-300 font-medium">Bookmark Title</label>
            <input
              type="text"
              placeholder="e.g. Unidentified vehicle at gate"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-zinc-900/80 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-400/80 transition-colors"
            />
          </div>

          {/* Category Select */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-300 font-medium flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-zinc-400" /> Category
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'incident', label: 'Incident', color: 'border-amber-400/60 text-amber-300 bg-amber-400/10' },
                { id: 'visitor', label: 'Visitor', color: 'border-emerald-400/60 text-emerald-300 bg-emerald-400/10' },
                { id: 'activity', label: 'Activity', color: 'border-cyan-400/60 text-cyan-300 bg-cyan-400/10' },
                { id: 'maintenance', label: 'Maintenance', color: 'border-zinc-400/60 text-zinc-300 bg-zinc-400/10' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium text-left transition-all ${
                    category === cat.id
                      ? `${cat.color} ring-1 ring-inset`
                      : 'hud-chip text-zinc-400 hover:text-zinc-200 hover:border-white/20'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-300 font-medium">Notes / Description (Optional)</label>
            <textarea
              rows={3}
              placeholder="Add incident observations or notes for shift handover..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-zinc-900/80 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-400/80 transition-colors resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-emerald-500 text-zinc-950 font-semibold rounded-lg text-xs hover:bg-emerald-400 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" /> Save Bookmark
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
