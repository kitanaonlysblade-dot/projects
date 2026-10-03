'use client';

import { Cake, Check, ChevronRight, MapPin, X } from 'lucide-react';
import type { Interest, ShippingAddress } from '@/lib/types';
import { PageHeader } from './PageHeader';

interface SettingsScreenProps {
  onBack: () => void;
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  defaultMuted: boolean;
  onToggleDefaultMuted: () => void;
  privateFollowLists: boolean;
  onTogglePrivateFollowLists: () => void;
  hideMutualFollowers: boolean;
  onToggleHideMutualFollowers: () => void;
  // Lifted to page.tsx and shared with DiscoverOnboarding/
  // UploadDiscoverPostModal — see that fetch's comment for why.
  interests: Interest[];
  discoverInterests: string[] | null | undefined;
  onChangeDiscoverInterests: (selected: string[] | null) => void;
  // Moved here from ProfileScreen — same "check or change it without
  // going through a purchase" entry point resolve_shipping_address's
  // own backend comment describes, just grouped under Account
  // alongside Log out instead of living on the profile page itself.
  shippingAddress: ShippingAddress | undefined;
  onOpenShippingAddress: () => void;
  // ISO date string ("YYYY-MM-DD") or undefined if never set. The only
  // thing this actually feeds is the backend's birthday-notification
  // sync (see UserProfile.birthday's own comment) — nothing here reads
  // the year back out for anything.
  birthday: string | undefined;
  onChangeBirthday: (birthday: string) => void;
  onLogOut: () => void;
}

// Was just a plain color swap (brand-gradient vs a flat gray) with
// nothing else distinguishing the two states — easy to read backwards,
// since the brand gradient is pink/orange rather than a color most
// people already associate with "on" (green, typically) — and green
// isn't this app's color anyway, so the fix stays inside the existing
// brand-gradient/gray pair rather than borrowing a different one.
// Three redundant signals now say which state you're looking at
// without leaning on color alone: a border on the off state so it
// reads as a distinct control against a white card instead of nearly
// vanishing into it, a check/X icon in the thumb, and an explicit
// "On"/"Off" word underneath.
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative h-7 w-[50px] rounded-full border transition-colors ${
          checked ? 'brand-gradient border-transparent' : 'border-line bg-box'
        }`}
      >
        <span
          className={`absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        >
          {checked ? (
            <Check size={15} strokeWidth={3} className="text-hot-pink" />
          ) : (
            <X size={14} strokeWidth={3} className="text-text-mute" />
          )}
        </span>
      </button>
      <span className={`text-[10.5px] font-bold uppercase tracking-wide ${checked ? 'text-hot-pink' : 'text-text-mute'}`}>
        {checked ? 'On' : 'Off'}
      </span>
    </div>
  );
}

function SettingRow({
  title,
  subtitle,
  checked,
  onChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white p-3.5">
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-text">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-text-mute">{subtitle}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

// Every toggle here does something real — no placeholder settings for
// features that don't exist.
//
// Discover interests specifically: real platforms (TikTok's "Content
// preferences", Instagram's "Suggested content", X's "Topics you follow")
// never replay the big first-run interest wizard once you're past it —
// they expose the SAME underlying preference as an ordinary, always-
// available settings section instead, so you can adjust it any time
// without being shoved back through a full-screen onboarding flow just to
// add one topic. This reuses the exact same interests list/persistence
// (useDiscoverInterests, passed down from page.tsx) that
// DiscoverOnboarding itself writes to — one source of truth, two entry
// points into it (first-run wizard, and this).
export function SettingsScreen({
  onBack,
  autoplayNext,
  onToggleAutoplayNext,
  defaultMuted,
  onToggleDefaultMuted,
  privateFollowLists,
  onTogglePrivateFollowLists,
  hideMutualFollowers,
  onToggleHideMutualFollowers,
  interests,
  discoverInterests,
  onChangeDiscoverInterests,
  shippingAddress,
  onOpenShippingAddress,
  birthday,
  onChangeBirthday,
  onLogOut,
}: SettingsScreenProps) {
  const selected = discoverInterests ?? [];

  const toggleInterest = (id: string) => {
    const next = selected.includes(id) ? selected.filter((existing) => existing !== id) : [...selected, id];
    onChangeDiscoverInterests(next);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <PageHeader title="Settings" onBack={onBack} backLabel="Back to profile" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:px-0 lg:py-6">
          <p className="mb-2 text-[12.5px] font-bold uppercase tracking-wide text-text-mute">Playback</p>
          <div className="flex flex-col gap-2">
            <SettingRow
              title="Autoplay next video"
              subtitle="When a video ends, move straight to the next one instead of stopping"
              checked={autoplayNext}
              onChange={onToggleAutoplayNext}
            />
            <SettingRow
              title="Mute videos by default"
              subtitle="Start each video muted until you tap to unmute"
              checked={defaultMuted}
              onChange={onToggleDefaultMuted}
            />
          </div>

          <p className="mb-2 mt-6 text-[12.5px] font-bold uppercase tracking-wide text-text-mute">Privacy</p>
          <div className="flex flex-col gap-2">
            <SettingRow
              title="Private followers/following lists"
              subtitle="Only you can see who follows you and who you follow — your follower and following counts stay visible to everyone either way"
              checked={privateFollowLists}
              onChange={onTogglePrivateFollowLists}
            />
            <SettingRow
              title="Hide mutual followers"
              subtitle="Stop other people from seeing how many followers you share in common with them on your profile"
              checked={hideMutualFollowers}
              onChange={onToggleHideMutualFollowers}
            />
          </div>

          <p className="mb-2 mt-6 text-[12.5px] font-bold uppercase tracking-wide text-text-mute">
            Discover
          </p>
          <div className="rounded-xl border border-line bg-white p-3.5">
            <p className="text-[14px] font-bold text-text">Content interests</p>
            <p className="mt-0.5 text-[12.5px] text-text-mute">
              {selected.length > 0
                ? 'Your Discover feed is personalized around these topics. Changes apply immediately.'
                : "You're currently seeing everything in Discover. Pick a few topics to personalize it."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {interests.map((interest) => {
                const isSelected = selected.includes(interest.id);
                return (
                  <button
                    key={interest.id}
                    onClick={() => toggleInterest(interest.id)}
                    aria-pressed={isSelected}
                    className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-left text-[13.5px] font-medium transition-colors ${
                      isSelected
                        ? 'brand-gradient border-transparent text-white'
                        : 'border-line text-text hover:border-hot-pink/40'
                    }`}
                  >
                    <span className="text-[13px] leading-none">{interest.emoji}</span>
                    {interest.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mb-2 mt-6 text-[12.5px] font-bold uppercase tracking-wide text-text-mute">Account</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={onOpenShippingAddress}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-white p-3.5 text-left"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
                <MapPin size={18} className="text-text-mute" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-text">Shipping address</span>
                <span className="block truncate text-[12.5px] text-text-mute">
                  {shippingAddress ? `${shippingAddress.line1}, ${shippingAddress.city}` : 'Not set yet'}
                </span>
              </span>
              <ChevronRight size={17} className="shrink-0 text-text-mute" />
            </button>
            {/* A native <input type="date"> has a browser-enforced
                minimum rendered width (room for "mm/dd/yyyy" plus its
                calendar icon) that CSS can't shrink it below. Packed
                into one row alongside the icon and this row's own
                description text on a narrow phone, that minimum didn't
                fit — and since the settings screen only scrolls
                vertically (see the panel's own overflow-y-auto a bit
                further down, no overflow-x anywhere), the input just
                ran off the right edge of the screen with no way to
                scroll to it. Below `sm`, the input now drops to its own
                full-width row instead of fighting the icon and text for
                horizontal space; at `sm` and up, where there's room,
                it's back to sitting inline exactly as before. */}
            <label className="flex w-full flex-col gap-3 rounded-xl border border-line bg-white p-3.5 text-left sm:flex-row sm:items-center">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel">
                  <Cake size={18} className="text-text-mute" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-text">Birthday</span>
                  <span className="block text-[12.5px] text-text-mute">
                    Lets people who follow you get a birthday reminder
                  </span>
                </span>
              </span>
              <input
                type="date"
                value={birthday ?? ''}
                onChange={(e) => onChangeBirthday(e.target.value)}
                aria-label="Birthday"
                className="w-full shrink-0 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12.5px] text-text focus:border-hot-pink focus:outline-none sm:w-auto"
              />
            </label>
            <button
              onClick={onLogOut}
              className="w-full rounded-xl border border-line bg-white p-3.5 text-left text-[14px] font-bold text-hot-pink"
            >
              Log out
            </button>
          </div>

          <p className="mt-4 text-[12.5px] text-text-mute">
            That&apos;s everything configurable right now — no separate
            notification-preferences screen beyond what&apos;s already here.
          </p>
        </div>
      </div>
    </div>
  );
}
