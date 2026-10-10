'use client';

import { useState } from 'react';
import { Search, Ban, RotateCcw, EyeOff, Eye } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { banUser, listUsers, unbanUser, shadowBanUser, unshadowBanUser, type ApiUser } from '@/lib/api';

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [banTarget, setBanTarget] = useState<ApiUser | null>(null);
  const [shadowBanTarget, setShadowBanTarget] = useState<ApiUser | null>(null);

  const runSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    listUsers({ q: query || undefined, limit: 50 })
      .then((results) => {
        setUsers(results);
        setSearched(true);
      })
      .finally(() => setLoading(false));
  };

  const handleBan = (reason: string) => {
    if (!banTarget) return;
    banUser(banTarget.id, reason || undefined).then((updated) => {
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setBanTarget(null);
    });
  };

  const handleUnban = (user: ApiUser) => {
    unbanUser(user.id).then((updated) => {
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    });
  };

  // No reason to collect — see ConfirmDialog's onConfirm signature;
  // shadowBanUser itself takes none (a shadow ban is never shown to
  // the account it's applied to, so there's nothing for a reason to
  // accompany — see shadowBanUser's own comment in lib/api.ts).
  const handleShadowBan = () => {
    if (!shadowBanTarget) return;
    shadowBanUser(shadowBanTarget.id).then((updated) => {
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setShadowBanTarget(null);
    });
  };

  const handleUnshadowBan = (user: ApiUser) => {
    unshadowBanUser(user.id).then((updated) => {
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    });
  };

  return (
    <AdminShell>
      <p className="mb-1 text-[20px] font-bold text-text">Users</p>
      <p className="mb-5 text-[13px] text-text-mute">Search accounts by name, username, or email.</p>

      <form onSubmit={runSearch} className="mb-5 flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users…"
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-[13px] outline-none focus:border-hot-pink"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-hot-pink px-4 py-2 text-[13px] font-bold text-white"
        >
          Search
        </button>
      </form>

      {loading && <p className="text-[13px] text-text-mute">Loading…</p>}

      {!loading && searched && users.length === 0 && (
        <p className="text-[13px] text-text-mute">No users found.</p>
      )}

      {users.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-panel text-[11px] uppercase text-text-mute">
              <tr>
                <th className="px-4 py-2.5 font-bold">Name</th>
                <th className="px-4 py-2.5 font-bold">Email</th>
                <th className="px-4 py-2.5 font-bold">Role</th>
                <th className="px-4 py-2.5 font-bold">Status</th>
                <th className="px-4 py-2.5 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text">{user.display_name}</p>
                    <p className="text-text-mute">@{user.username}</p>
                  </td>
                  <td className="px-4 py-3 text-text-mute">{user.email}</td>
                  <td className="px-4 py-3 capitalize text-text-mute">{user.role}</td>
                  <td className="px-4 py-3">
                    {user.is_active ? (
                      <span className="text-success">Active</span>
                    ) : (
                      <span className="text-danger" title={user.ban_reason ?? undefined}>
                        Suspended
                      </span>
                    )}
                    {user.is_shadow_banned && (
                      <span
                        title="Their content is hidden from everyone else's feeds and comment threads, but the account itself sees no difference."
                        className="ml-1.5 rounded-full bg-panel px-1.5 py-0.5 text-[10px] font-bold text-text-mute"
                      >
                        Shadow-banned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {user.role === 'admin' ? null : user.is_active ? (
                        <button
                          onClick={() => setBanTarget(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/5"
                        >
                          <Ban size={13} />
                          Ban
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUnban(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-success hover:bg-success/5"
                        >
                          <RotateCcw size={13} />
                          Unban
                        </button>
                      )}
                      {user.role === 'admin' ? null : user.is_shadow_banned ? (
                        <button
                          onClick={() => handleUnshadowBan(user)}
                          title="Restores their content to everyone else's feeds and comment threads."
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-text hover:bg-panel"
                        >
                          <Eye size={13} />
                          Un-shadow-ban
                        </button>
                      ) : (
                        <button
                          onClick={() => setShadowBanTarget(user)}
                          title="Hides their content from everyone else's feeds and comment threads. The account itself never finds out — nothing changes from their side."
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-text-mute hover:bg-panel"
                        >
                          <EyeOff size={13} />
                          Shadow ban
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {banTarget && (
        <ConfirmDialog
          title={`Ban ${banTarget.display_name}?`}
          body="They'll still be able to log in far enough to see this and file an appeal — everything else is blocked."
          noteLabel="Reason (shown to the user)"
          notePlaceholder="e.g. Repeated counterfeit listings"
          confirmLabel="Ban account"
          danger
          onConfirm={handleBan}
          onClose={() => setBanTarget(null)}
        />
      )}

      {shadowBanTarget && (
        <ConfirmDialog
          title={`Shadow ban ${shadowBanTarget.display_name}?`}
          body="Nothing changes from their side — they can keep posting, commenting, and buying with no error. Everyone else just stops seeing their posts and comments. No reason field, since it's never shown to them."
          confirmLabel="Shadow ban"
          danger
          onConfirm={handleShadowBan}
          onClose={() => setShadowBanTarget(null)}
        />
      )}
    </AdminShell>
  );
}
