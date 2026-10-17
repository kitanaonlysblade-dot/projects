import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Same brand accent as the consumer app (lumin-app) — one
        // platform, one accent color — but everything else here reads
        // as a plain ops dashboard (light surfaces, data tables), not
        // the video app's dark/full-bleed aesthetic. There's no reason
        // for an internal tool to share that visual language.
        'hot-pink': '#FF2D6F',
        'hot-orange': '#FF6B35',
        ink: '#0B0B0F',
        panel: '#f7f7f8',
        line: '#e5e5e8',
        text: '#18181b',
        'text-mute': '#71717a',
        // Status colors — used consistently for every status badge
        // across users/appeals/reports/disputes, so "pending" always
        // looks like "pending" regardless of which queue it's in.
        success: '#16a34a',
        danger: '#dc2626',
        warning: '#d97706',
      },
    },
  },
  plugins: [],
};

export default config;
