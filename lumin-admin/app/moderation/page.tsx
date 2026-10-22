'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import {
  ApiError,
  addModerationTerm,
  decideModerationItem,
  deleteModerationTerm,
  getModerationSummary,
  listModerationItems,
  listModerationTerms,
  type ApiModerationItem,
  type ApiModerationSummary,
  type ApiModerationTerm,
} from '@/lib/api';

const TARGET: Record<string, string> = { video_post: 'Video', comment: 'Comment', user: 'Profile', product: 'Product listing' };
const SOURCE: Record<string, string> = { text: 'Word filter', media: 'Picture check', reports: 'Reports' };

// Everything the automatic checks flagged. Red "Hidden" items are videos already hidden from everyone but their owner:
// they are waiting for you, so work through those first. Approve = it's fine (restored, and the same content is not
// flagged again). Remove = take it down and tell the owner.
export default function ModerationPage() {
  const [tab, setTab] = useState<'queue' | 'words'>('queue');
  const [summary, setSummary] = useState<ApiModerationSummary | null>(null);

  const loadSummary = useCallback(() => {
    getModerationSummary().then(setSummary).catch(() => {});
  }, []);
  useEffect(loadSummary, [loadSummary]);

  return (
    <AdminShell>
      <h1 className="mb-1 text-xl font-bold text-text">Moderation</h1>
      {summary && (
        <p className="mb-4 text-[13px] text-text-mute">
          {summary.pending} waiting ({summary.pending_held} hidden) · {summary.removed} removed · {summary.approved} approved ·{' '}
          {summary.picture_checks_on ? 'picture checks on' : <span className="font-semibold text-danger">picture checks OFF (set MODERATION_PROVIDER and OPENAI_API_KEY)</span>}
        </p>
      )}
      <div className="mb-5 flex gap-2">
        {(['queue', 'words'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${tab === t ? 'bg-text text-white' : 'bg-white text-text-mute'}`}>
            {t === 'queue' ? 'Review queue' : `Word list${summary ? ` (${summary.terms})` : ''}`}
          </button>
        ))}
      </div>
      {tab === 'queue' ? <Queue onChange={loadSummary} /> : <Words onChange={loadSummary} />}
    </AdminShell>
  );
}

function Queue({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<ApiModerationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    listModerationItems('pending')
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const decide = async (id: string, action: 'approve' | 'remove') => {
    setBusy(id);
    setError(null);
    try {
      await decideModerationItem(id, action, action === 'remove' ? note : undefined);
      setItems((cur) => (cur ?? []).filter((i) => i.id !== id));
      setRemoving(null);
      setNote('');
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button onClick={load} className="rounded-full bg-white px-3 py-1 text-[13px] font-medium text-text-mute">
          Refresh
        </button>
      </div>
      {failed && <p className="text-[13px] text-red-600">Couldn&apos;t load the queue.</p>}
      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
      {!items && !failed && <p className="text-[13px] text-text-mute">Loading…</p>}
      {items && items.length === 0 && <p className="text-[13px] text-text-mute">Nothing waiting. 🎉</p>}
      <div className="space-y-4">
        {items?.map((i) => (
          <div key={i.id} className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
              {i.severity === 'held' && <span className="rounded-full bg-danger/10 px-2 py-0.5 font-bold text-danger">Hidden</span>}
              <span className="font-bold text-text">{TARGET[i.target_type] ?? i.target_type}</span>
              <span className="text-text-mute">
                {SOURCE[i.source] ?? i.source} · {i.category}
                {i.score != null ? ` ${Math.round(i.score * 100)}%` : ''}
              </span>
              <span className="text-text-mute">· {new Date(i.created_at).toLocaleString()}</span>
            </div>
            <p className="mb-2 text-[12.5px] text-text-mute">
              Owner: {i.owner_username ? `@${i.owner_username}` : 'unknown'}
              {i.owner_removed_count > 0 && <span className="font-semibold text-danger"> · {i.owner_removed_count} earlier removal{i.owner_removed_count > 1 ? 's' : ''}</span>}
              {i.detail ? ` · ${i.detail}` : ''}
            </p>
            <div className="mb-3 flex flex-wrap gap-3">
              {i.preview.video_url && <video src={i.preview.video_url} poster={i.preview.thumbnail_url ?? undefined} controls preload="none" className="max-h-72 rounded-lg bg-black" />}
              {!i.preview.video_url && i.preview.images && i.preview.images.length > 0 && i.preview.images.map((u) => <img key={u} src={u} alt="" className="max-h-40 rounded-lg" />)}
              {!i.preview.video_url && !i.preview.images?.length && i.preview.thumbnail_url && <img src={i.preview.thumbnail_url} alt="" className="max-h-40 rounded-lg" />}
              {i.preview.text && <p className="whitespace-pre-wrap break-words text-[13.5px] text-text">{i.preview.text}</p>}
              {Object.keys(i.preview).length === 0 && <p className="text-[13px] text-text-mute">The content is already gone.</p>}
            </div>
            {removing === i.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  placeholder="Reason shown to the owner (optional)"
                  className="min-w-[220px] flex-1 rounded-lg border border-line px-3 py-2 text-[13px]"
                />
                <button disabled={busy === i.id} onClick={() => decide(i.id, 'remove')} className="rounded-full bg-danger px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-50">
                  Confirm remove
                </button>
                <button onClick={() => setRemoving(null)} className="text-[13px] text-text-mute">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button disabled={busy === i.id} onClick={() => decide(i.id, 'approve')} className="rounded-full bg-text px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-50">
                  Approve
                </button>
                <button onClick={() => setRemoving(i.id)} className="rounded-full border border-danger px-4 py-1.5 text-[13px] font-bold text-danger">
                  Remove…
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Words({ onChange }: { onChange: () => void }) {
  const [terms, setTerms] = useState<ApiModerationTerm[] | null>(null);
  const [term, setTerm] = useState('');
  const [action, setAction] = useState<'block' | 'flag'>('block');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listModerationTerms()
      .then(setTerms)
      .catch(() => setError("Couldn't load the list."));
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    if (!term.trim()) return;
    setError(null);
    try {
      await addModerationTerm(term.trim(), action);
      setTerm('');
      load();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };
  const remove = async (id: string) => {
    await deleteModerationTerm(id).catch(() => {});
    load();
    onChange();
  };

  return (
    <>
      <p className="mb-3 max-w-xl text-[13px] text-text-mute">
        <b>Block</b> refuses the caption, comment, bio or listing with a message. <b>Flag</b> lets it through and adds it to the review queue. Whole words only (so &quot;class&quot; is not caught by &quot;ass&quot;); common letter swaps like
        &quot;sh1t&quot; are matched, but add other spellings and other languages yourself. The list starts empty.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Word or phrase"
          maxLength={100}
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[13px]"
        />
        <select value={action} onChange={(e) => setAction(e.target.value as 'block' | 'flag')} className="rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
          <option value="block">Block</option>
          <option value="flag">Flag for review</option>
        </select>
        <button onClick={add} className="rounded-full bg-text px-4 py-2 text-[13px] font-bold text-white">
          Add
        </button>
      </div>
      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
      {terms && terms.length === 0 && <p className="text-[13px] text-text-mute">No words yet.</p>}
      <div className="flex flex-wrap gap-2">
        {terms?.map((t) => (
          <span key={t.id} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] ${t.action === 'block' ? 'bg-danger/10 text-danger' : 'bg-white text-text'}`}>
            {t.term} <span className="text-[11px] uppercase opacity-60">{t.action}</span>
            <button onClick={() => remove(t.id)} aria-label={`Remove ${t.term}`} className="font-bold opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        ))}
      </div>
    </>
  );
}
