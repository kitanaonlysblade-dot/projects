'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Flag,
  MessageSquareWarning,
  Scale,
  PackageCheck,
  Truck,
  Trash2,
  Link2,
  Activity,
  ScanSearch,
  Copy,
  Cog,
  BadgeCheck,
  ShieldAlert,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { clearToken, getMe, getMfaStatus, getToken, type ApiUser } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/moderation', label: 'Moderation', icon: ShieldAlert },
  { href: '/reports', label: 'Reports', icon: Flag },
  { href: '/appeals', label: 'Appeals', icon: MessageSquareWarning },
  { href: '/disputes', label: 'Disputes', icon: Scale },
  { href: '/seals', label: 'Sealed bags', icon: PackageCheck },
  { href: '/shipments', label: 'Shipments', icon: Truck },
  { href: '/twins', label: 'Twins', icon: Link2 },
  { href: '/twin-stats', label: 'Twin health', icon: Activity },
  { href: '/scan-stats', label: 'Scan results', icon: ScanSearch },
  { href: '/copy-reports', label: 'Copy reports', icon: Copy },
  { href: '/content', label: 'Content', icon: Trash2 },
  { href: '/verifications', label: 'Seller verification', icon: BadgeCheck },
  { href: '/jobs', label: 'Background jobs', icon: Cog },
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
  // Phone / tablet: the menu is a drawer opened from the top bar; it closes after choosing a page.
  const [menuOpen, setMenuOpen] = useState(false);

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
        // A password-only session cannot call admin routes: send it to the second step.
        return getMfaStatus().then((mfa) => {
          if (!mfa.session_ok) {
            router.replace('/login');
            return;
          }
          setMe(user);
          setChecking(false);
        });
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
    <div className="flex h-screen flex-col lg:flex-row">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-3 lg:hidden">
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="-ml-1 rounded-lg p-1.5 text-text hover:bg-panel">
          <Menu size={20} />
        </button>
        <p className="text-[15px] font-bold text-text">Lumin Admin</p>
      </header>
      {menuOpen && <div onClick={() => setMenuOpen(false)} aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-line bg-white transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-text">Lumin Admin</p>
            <p className="truncate text-[11px] text-text-mute">{me.email}</p>
          </div>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="-mr-1 rounded-lg p-1 text-text-mute lg:hidden">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors lg:py-2 ${
                  active ? 'bg-ink text-white' : 'text-text hover:bg-panel'
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
      <main className="min-w-0 flex-1 overflow-y-auto bg-panel p-4 sm:p-6">{children}</main>
    </div>
  );
}
