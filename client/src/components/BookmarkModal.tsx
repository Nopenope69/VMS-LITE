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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#090d16] border border-[#1f2937] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f2937] bg-[#111827]">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-[#fb923c]" />
            <h2 className="text-sm font-semibold text-slate-100">Add Timeline Bookmark</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-md hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3 bg-red-950/40 border border-red-800/80 rounded-lg text-red-200 text-xs">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Timestamp Indicator */}
          <div className="flex items-center gap-3 p-2.5 bg-[#111827] rounded-lg border border-[#1f2937] text-xs text-slate-300 font-mono">
            <Clock className="w-4 h-4 text-[#4fc3f7]" />
            <div>
              <span className="text-slate-400 text-[10px] uppercase block font-sans">Timestamp</span>
              <span className="font-semibold text-slate-100">{timestamp.toLocaleString()}</span>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label className="text-xs text-slate-300 font-medium">Bookmark Title</label>
            <input
              type="text"
              placeholder="e.g. Unidentified vehicle at gate"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-[#111827] border border-[#1f2937] rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#4fc3f7]"
            />
          </div>

          {/* Category Select */}
          <div className="space-y-1">
            <label className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-400" /> Category
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'incident', label: 'Incident', color: 'border-[#fb923c] text-[#fb923c]' },
                { id: 'visitor', label: 'Visitor', color: 'border-[#10b981] text-[#10b981]' },
                { id: 'activity', label: 'Activity', color: 'border-[#4fc3f7] text-[#4fc3f7]' },
                { id: 'maintenance', label: 'Maintenance', color: 'border-slate-400 text-slate-400' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold text-left transition-all ${
                    category === cat.id
                      ? `bg-[#111827] ${cat.color} ring-1 ring-inset shadow-[0_0_8px_rgba(255,255,255,0.05)]`
                      : 'bg-[#111827]/40 border-[#1f2937] text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs text-slate-300 font-medium">Notes / Description (Optional)</label>
            <textarea
              rows={3}
              placeholder="Add incident observations or notes for shift handover..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#111827] border border-[#1f2937] rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#4fc3f7] resize-none"
            />
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-[#fb923c] text-slate-950 font-bold rounded-lg text-xs hover:bg-[#f97316] disabled:opacity-50 transition-colors flex items-center gap-1.5"
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
