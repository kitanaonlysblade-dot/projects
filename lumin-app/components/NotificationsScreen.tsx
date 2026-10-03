'use client';

import { Bell, CornerUpLeft, Heart, MessageCircle, Package, Smile, Tag, UserPlus } from 'lucide-react';
import type { Notification } from '@/lib/types';
import { PageHeader } from './PageHeader';

// Same Heart/MessageCircle vocabulary VideoStage/ProfileScreen already
// use for like/comment elsewhere in this app, so a notification about
// either reads as the same action, not a new icon language. Every
// notification now gets one, sitting beside its text the same way the
// like/comment ones always did: product (Tag), order (Package) and
// user — new follower / birthday — (UserPlus) join the four engagement
// types, and anything untyped (e.g. moderation notices) gets a Bell.
function NotificationIcon({ type }: { type: Notification['type'] }) {
  const common = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full';
  switch (type) {
    case 'post_like':
      return (
        <span className={`${common} bg-hot-pink/10 text-hot-pink`}>
          <Heart size={15} fill="currentColor" />
        </span>
      );
    case 'post_comment':
      return (
        <span className={`${common} bg-hot-pink/10 text-hot-pink`}>
          <MessageCircle size={15} />
        </span>
      );
    case 'comment_reply':
      return (
        <span className={`${common} bg-violet/10 text-violet`}>
          <CornerUpLeft size={15} />
        </span>
      );
    case 'comment_reaction':
      return (
        <span className={`${common} bg-hot-orange/10 text-hot-orange`}>
          <Smile size={15} />
        </span>
      );
    case 'product':
      return (
        <span className={`${common} bg-hot-orange/10 text-hot-orange`}>
          <Tag size={15} />
        </span>
      );
    case 'order':
      return (
        <span className={`${common} bg-violet/10 text-violet`}>
          <Package size={15} />
        </span>
      );
    case 'user':
      return (
        <span className={`${common} bg-hot-pink/10 text-hot-pink`}>
          <UserPlus size={15} />
        </span>
      );
    default:
      return (
        <span className={`${common} bg-box text-text-mute`}>
          <Bell size={15} />
        </span>
      );
  }
}

interface NotificationsScreenProps {
  notifications: Notification[];
  onBack: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onSelectNotification: (notification: Notification) => void;
}

export function NotificationsScreen({
  notifications,
  onBack,
  onMarkRead,
  onMarkAllRead,
  onSelectNotification,
}: NotificationsScreenProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleTap = (n: Notification) => {
    onMarkRead(n.id);
    onSelectNotification(n);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Notifications" onBack={onBack} backLabel="Back to shop" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-4 py-4 lg:px-0 lg:py-6">
          {notifications.length > 0 && (
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[12.5px] text-text-mute">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
              {unreadCount > 0 && (
                <button onClick={onMarkAllRead} className="text-[12.5px] font-bold text-hot-pink">
                  Mark all as read
                </button>
              )}
            </div>
          )}

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Bell size={22} className="text-text-mute" />
              <p className="text-[13px] font-bold text-text">No notifications</p>
              <p className="max-w-[220px] text-[13.5px] text-text-mute">
                You&apos;ll see updates about your orders and wishlist here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleTap(n)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left ${
                    n.read ? 'border-line bg-white' : 'border-hot-pink/30 bg-hot-pink/5'
                  }`}
                >
                  {/* The icon sits in the same spot whether or not the
                      notice is read; unread is shown as a dot on the
                      icon's corner instead of a separate column, which
                      used to shift everything sideways once read. */}
                  <span className="relative shrink-0">
                    <NotificationIcon type={n.type} />
                    {!n.read && (
                      <span
                        aria-label="Unread"
                        className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-hot-pink"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug text-text">{n.body}</p>
                    <p className="mt-1 text-[12px] text-text-mute">{n.time}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
