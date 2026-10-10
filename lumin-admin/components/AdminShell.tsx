'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Flag,
  MessageSquareWarning,
  Scale,
  Trash2,
  Link2,
  Activity,
  LogOut,
} from 'lucide-react';
import { clearToken, getMe, getToken, type ApiUser } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/reports', label: 'Reports', icon: Flag },
  { href: '/appeals', label: 'Appeals', icon: MessageSquareWarning },
  { href: '/disputes', label: 'Disputes', icon: Scale },
  { href: '/twins', label: 'Twins', icon: Link2 },
  { href: '/twin-stats', label: 'Twin health', icon: Activity },
  { href: '/content', label: 'Content', icon: Trash2 },
];

// Wraps every authenticated page (dashboard, users, reports, appeals,
// disputes, content) — checks for a token and an admin role on mount,
// and redirects to /login rather than rendering anything for either a
// missing token or a non-admin one. This is a client-side check only
// (no middleware) — the real enforcement is the backend's
// get_current_admin on every /admin/* call; this is just what keeps
// someone from staring at an empty/erroring dashboard for a few seconds
// before every fetch on it starts failing with 403s.
export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<ApiUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    getMe()
      .then((user) => {
        if (user.role !== 'admin') {
          clearToken();
          router.replace('/login');
          return;
        }
        setMe(user);
        setChecking(false);
      })
      .catch(() => {
        clearToken();
        router.replace('/login');
      });
  }, [router]);

  const handleLogOut = () => {
    clearToken();
    router.replace('/login');
  };

  if (checking || me === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-text-mute">
        Checking session…
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <p className="text-[15px] font-bold text-text">Lumin Admin</p>
          <p className="truncate text-[11px] text-text-mute">{me.email}</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <a
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  active ? 'bg-hot-pink text-white' : 'text-text hover:bg-panel'
                }`}
              >
                <Icon size={16} />
                {label}
              </a>
            );
          })}
        </nav>
        <button
          onClick={handleLogOut}
          className="flex items-center gap-2.5 border-t border-line px-5 py-3 text-[13px] font-medium text-text-mute hover:text-text"
        >
          <LogOut size={16} />
          Log out
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto bg-panel p-6">{children}</main>
    </div>
  );
}
