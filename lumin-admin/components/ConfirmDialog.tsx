'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  body?: string;
  // When set, shows a textarea and passes its value back to onConfirm —
  // used for a ban reason, a resolution note, a denial explanation,
  // etc. Optional field either way (an empty string is a valid answer,
  // matching every one of these being an Optional[str] on the backend).
  noteLabel?: string;
  notePlaceholder?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (note: string) => void;
  onClose: () => void;
}

// One shared modal for every "are you sure, and why" action in this
// app — ban a user, deny an appeal/report/claim, remove a listing. Kept
// deliberately generic rather than one bespoke modal per page, since
// the shape (a title, an optional note field, confirm/cancel) is
// identical everywhere it's used.
export function ConfirmDialog({
  title,
  body,
  noteLabel,
  notePlaceholder,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <p className="text-[15px] font-bold text-text">{title}</p>
          <button onClick={onClose} className="text-text-mute hover:text-text">
            <X size={18} />
          </button>
        </div>
        {body && <p className="mb-4 text-[13px] text-text-mute">{body}</p>}
        {noteLabel && (
          <label className="mb-5 block">
            <span className="mb-1 block text-[12px] font-medium text-text-mute">{noteLabel}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={notePlaceholder}
              rows={3}
              className="w-full rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-hot-pink"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-text hover:bg-panel"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(note)}
            className={`rounded-lg px-4 py-2 text-[13px] font-bold text-white ${
              danger ? 'bg-danger' : 'bg-hot-pink'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
