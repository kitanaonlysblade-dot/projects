'use client';

import { useEffect, useState } from 'react';

// Light / Dark / Match my device. The choice is kept on this device. The "dark" class on <html> is set by a tiny
// script in app/layout.tsx BEFORE the first paint (so there is no white flash), and kept in step here afterwards.
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'lumin-theme';
const CHANGED = 'lumin:theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // storage blocked: follow the phone
  }
  return 'system';
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  const dark = choice === 'dark' || (choice === 'system' && prefersDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  // The browser / status-bar colour follows the page.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0c0c10' : '#ffffff');
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // not remembered, still applied for this visit
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(CHANGED));
}

// The current choice, and keeps the page in step with the device while "Match my device" is selected.
export function useThemeChoice(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => {
    setChoice(getThemeChoice());
    const onChange = () => setChoice(getThemeChoice());
    window.addEventListener(CHANGED, onChange);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (getThemeChoice() === 'system') applyTheme('system');
    };
    mq?.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener(CHANGED, onChange);
      mq?.removeEventListener?.('change', onSystem);
    };
  }, []);
  return [choice, setThemeChoice];
}

// Runs inline in <head> before anything paints (see app/layout.tsx).
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem('${KEY}');var d=c==='dark'||((c!=='light')&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?'#0c0c10':'#ffffff');}catch(e){}})();`;
