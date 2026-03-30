'use client';

import { useState } from 'react';
import { X, Trash2, Loader2, AlertTriangle } from 'lucide-react';

interface Props {
  messageId: string;
  channelType: string;
  channelId: string;
  messageText: string;
  messageAuthor: string;
  isSystemMessage: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

const REASONS = [
  { value: 'mistake', label: 'Sent by mistake' },
  { value: 'change_of_plans', label: 'Change of plans' },
  { value: 'duplicate', label: 'Duplicate message' },
  { value: 'testing_debug', label: 'Testing / debug message' },
  { value: 'other', label: 'Other' },
];

export function DeleteMessageModal({
  messageId,
  channelType,
  channelId,
  messageText,
  messageAuthor,
  isSystemMessage,
  onClose,
  onDeleted,
}: Props) {
  const [reason, setReason] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/chat/delete-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          channel_type: channelType,
          channel_id: channelId,
          reason,
          reason_detail: reasonDetail || undefined,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to delete message');
        setLoading(false);
        return;
      }

      onDeleted();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Truncate long messages for the preview
  const previewText = messageText.length > 120
    ? messageText.slice(0, 120) + '…'
    : messageText;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-red-50 border-b border-red-100 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <Trash2 size={16} className="text-red-600" />
            </div>
            <h2 className="text-base font-bold text-red-900">Delete Message</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-red-100 rounded-lg transition-colors">
            <X size={16} className="text-red-400" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-2.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">
              This message will be hidden from the chat and moved to the &quot;Deleted Messages&quot; section.
              This action is logged and cannot be undone.
            </p>
          </div>

          {/* Message preview */}
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
              {isSystemMessage ? '🤖 Rounds System' : messageAuthor}
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{previewText}</p>
          </div>

          {/* Reason selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Why are you deleting this? <span className="text-red-400">*</span>
            </label>
            <div className="space-y-1.5">
              {REASONS.map(r => (
                <label
                  key={r.value}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    reason === r.value
                      ? 'border-red-300 bg-red-50/60'
                      : 'border-gray-150 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => { setReason(r.value); setError(''); }}
                    className="accent-red-500"
                  />
                  <span className="text-sm text-gray-700">{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Optional detail */}
          {reason === 'other' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Details (optional)</label>
              <textarea
                value={reasonDetail}
                onChange={e => setReasonDetail(e.target.value)}
                placeholder="Add a brief note..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-300 focus:border-red-300 outline-none resize-none"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3 flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading || !reason}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {loading ? 'Deleting...' : 'Delete Message'}
          </button>
        </div>
      </div>
    </div>
  );
}
