'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, LogOut } from 'lucide-react';
import { ApiError, fileAppeal, listMyAppeals, type ApiAppeal } from '@/lib/api';

interface SuspensionScreenProps {
  banReason?: string;
  bannedAt?: string;
  onLogOut: () => void;
}

// The only screen a banned account can reach — every other protected
// route 403s via get_current_active_user (auth/dependencies.py) the
// moment is_active is false, but GET /auth/me and the two appeal
// routes below are the deliberate exceptions that let this screen
// exist at all. Reached from handleCreateAccount (right after login/
// signup) and the session-restore effect in page.tsx, both checking
// the same profile.isActive.
export function SuspensionScreen({ banReason, bannedAt, onLogOut }: SuspensionScreenProps) {
  const [appeals, setAppeals] = useState<ApiAppeal[] | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyAppeals()
      .then(setAppeals)
      .catch(() => setAppeals([]));
  }, []);

  const handleSubmit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const appeal = await fileAppeal(message.trim());
      setAppeals((prev) => [appeal, ...(prev ?? [])]);
      setMessage('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit your appeal — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Newest first — GET /users/me/appeals already returns them that way,
  // this just reads the front of the array rather than re-sorting.
  const latest = appeals && appeals.length > 0 ? appeals[0] : null;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center justify-end px-4 py-3 lg:px-0">
        <button
          onClick={onLogOut}
          className="flex items-center gap-1.5 text-[13.5px] font-medium text-text-mute hover:text-text"
        >
          <LogOut size={16} />
          Log out
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 pb-10 lg:px-0">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-hot-pink/10">
            <AlertTriangle size={24} className="text-hot-pink" />
          </span>
          <p className="mb-1 text-[16px] font-bold text-text">Your account is suspended</p>
          <p className="mb-5 text-[14px] leading-snug text-text-mute">
            {banReason ? banReason : "This account has been suspended for violating Lumin's guidelines."}
            {bannedAt && (
              <span className="block mt-1 text-[13px] text-text-mute/80">
                Suspended on {new Date(bannedAt).toLocaleDateString()}
              </span>
            )}
          </p>

          {appeals === null && <p className="text-[14px] text-text-mute">Loading…</p>}

          {appeals !== null && latest?.status === 'pending' && (
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="mb-1 text-[14px] font-bold text-text">Appeal submitted</p>
              <p className="mb-2 text-[13.5px] text-text-mute">
                We&apos;re reviewing it — you&apos;ll be able to log in normally again if it&apos;s approved.
              </p>
              <p className="rounded-lg bg-panel p-2.5 text-[13.5px] text-text-mute">{latest.message}</p>
            </div>
          )}

          {appeals !== null && latest?.status !== 'pending' && (
            <>
              {latest?.status === 'denied' && (
                <div className="mb-4 rounded-xl border border-line bg-white p-4">
                  <p className="mb-1 text-[14px] font-bold text-text">Your last appeal was denied</p>
                  {latest.admin_response && (
                    <p className="text-[13.5px] text-text-mute">{latest.admin_response}</p>
                  )}
                </div>
              )}
              <label className="mb-3 block">
                <span className="mb-1.5 block text-[13.5px] font-medium text-text-mute">
                  {latest?.status === 'denied' ? 'File another appeal' : 'Explain why this should be reversed'}
                </span>
                <textarea
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setError(null);
                  }}
                  rows={5}
                  placeholder="Tell us why you think this was a mistake…"
                  className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[13px] text-text placeholder:text-text-mute"
                />
              </label>
              {error && <p className="mb-3 text-[13px] text-hot-pink">{error}</p>}
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || submitting}
                className="brand-gradient w-full rounded-full py-3 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit appeal'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
