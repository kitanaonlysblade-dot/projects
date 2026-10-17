import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0B0F',
        'ink-2': '#1c1a22',
        panel: '#f2f2f2',
        box: '#dcdcdc',
        line: '#e6e6e6',
        text: '#1a1a1a',
        'text-mute': '#6b6b6b',
        'hot-pink': '#FF2D6F',
        'hot-orange': '#FF6B35',
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
