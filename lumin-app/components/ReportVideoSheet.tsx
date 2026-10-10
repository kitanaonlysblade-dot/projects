'use client';

import { useEffect, useState } from 'react';
import { Flag, X } from 'lucide-react';
import type { VideoPost } from '@/lib/types';
import { ApiError, fileReport, type ApiReportReason } from '@/lib/api';

interface ReportVideoSheetProps {
  post: VideoPost;
  open: boolean;
  onClose: () => void;
}

// Real now — POST /reports (routers/reports.py), landing in the same
// admin Reports queue lumin-admin's /reports page reviews. Reason
// labels here are worded for a video specifically ("Nudity or graphic
// content" rather than the backend's bare "inappropriate"); `value` on
// each is what actually gets sent, matching ReportReason's fixed enum
// on the backend exactly — there's no free-text reason, so these five
// have to cover everything, with "Something else" as the catch-all.
const REASONS: { value: ApiReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or misleading' },
  { value: 'inappropriate', label: 'Nudity or graphic content' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'counterfeit', label: 'Counterfeit goods shown' },
  { value: 'other', label: 'Something else' },
];

export function ReportVideoSheet({ post, open, onClose }: ReportVideoSheetProps) {
  const [reason, setReason] = useState<ApiReportReason | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always reopen on a clean first step — never stuck showing a stale
  // pick, an old error, or last time's confirmation screen.
  useEffect(() => {
    if (!open) {
      setReason(null);
      setSubmitted(false);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await fileReport({ target_type: 'video_post', target_id: post.id, reason });
      setSubmitted(true);
    } catch (err) {
      // Most likely cause: nobody's logged in — fileReport requires
      // auth the same as filing anything else in this app does.
      // Reporting doesn't have its own "log in first" redirect the way
      // Buy Now or Checkout do (this sheet has no navigation control
      // passed into it), so this just says so inline instead.
      setError(
        err instanceof ApiError && err.status === 401
          ? "You'll need to be logged in to report a video."
          : err instanceof ApiError
            ? err.message
            : "Couldn't submit this report — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop — tap anywhere outside the sheet/modal to dismiss it,
          same convention as MoreMenu/CategorySheet elsewhere in this app. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-[70] bg-black/40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Mobile/tablet: bottom sheet, matching MoreMenu's own mechanics.
          Desktop: centered modal card instead of a sheet — there's no
          "slide up from the edge" idiom on a pointer-driven desktop
          layout, same reasoning CommentsPanel already applies to split
          its own mobile/desktop presentation. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report this video"
        className={`fixed inset-x-0 bottom-0 z-[80] rounded-t-2xl bg-white pb-6 pt-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] transition-transform duration-300 lg:inset-x-auto lg:inset-y-0 lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-full lg:max-w-[380px] lg:-translate-x-1/2 lg:rounded-2xl lg:pt-4 lg:shadow-xl ${
          open
            ? 'translate-y-0 lg:-translate-y-1/2'
            : 'pointer-events-none translate-y-full lg:-translate-y-[calc(50%-16px)] lg:opacity-0'
        }`}
      >
        {/* Mobile-only drag handle, mirrors MoreMenu's. */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="mx-auto mb-2 flex w-full flex-col items-center gap-2 py-2 lg:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-box" />
        </button>

        <div className="flex items-center justify-between px-[18px] lg:pb-3">
          <p className="text-[13px] font-bold text-text">
            {submitted ? 'Report submitted' : 'Report this video'}
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="hidden text-text-mute hover:text-text lg:block"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-[18px] pt-3">
          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-panel">
                <Flag size={20} className="text-hot-pink" />
              </span>
              <p className="text-[14px] text-text-mute">
                Thanks for letting us know. We&apos;ll review this video against our
                guidelines.
              </p>
              <button
                onClick={onClose}
                className="brand-gradient mt-2 w-full rounded-full py-3 text-[13px] font-bold text-white"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-text-mute">
                Why are you reporting this video? This won&apos;t notify the poster.
              </p>
              <div className="flex flex-col gap-2">
                {REASONS.map((option) => {
                  const isSelected = reason === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        setReason(option.value);
                        setError(null);
                      }}
                      aria-pressed={isSelected}
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-[14px] font-medium transition-colors ${
                        isSelected
                          ? 'border-hot-pink bg-panel text-text'
                          : 'border-line text-text hover:border-hot-pink/40'
                      }`}
                    >
                      {option.label}
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                          isSelected ? 'border-hot-pink bg-hot-pink' : 'border-box'
                        }`}
                      >
                        {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {error && <p className="mt-2 text-[13px] text-hot-pink">{error}</p>}
              <button
                onClick={handleSubmit}
                disabled={!reason || submitting}
                className="brand-gradient mt-4 w-full rounded-full py-3 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
