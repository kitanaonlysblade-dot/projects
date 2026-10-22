import type { Config } from 'tailwindcss';

const config: Config = {
  // Dark mode is a class on <html> (set by lib/theme.ts before first paint), not the OS setting directly,
  // so the person can choose Light / Dark / Match my device.
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        ink: '#0B0B0F',
        'ink-2': '#1c1a22',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        box: 'rgb(var(--c-box) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        text: 'rgb(var(--c-text) / <alpha-value>)',
        'text-mute': 'rgb(var(--c-mute) / <alpha-value>)',
        price: 'rgb(var(--c-price) / <alpha-value>)',
        sale: 'rgb(var(--c-sale) / <alpha-value>)',
        'hot-pink': '#F5334A',
        // Small pink text: deeper on light, lighter on dark, so it is readable (see --c-pink-ink in globals.css).
        'pink-ink': 'rgb(var(--c-pink-ink) / <alpha-value>)',
        'hot-orange': '#EE5A24',
        violet: '#7C3AED',
      },
      borderRadius: {
        xl2: '14px',
      },
    },
  },
  plugins: [],
};

export default config;
