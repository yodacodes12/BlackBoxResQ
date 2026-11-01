import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#0a1220',
        panel: '#0f1b2e',
        panel2: '#14243b',
        line: '#22324d',
        accent: '#3b9eff',
        ok: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171',
        muted: '#8aa0bf',
      },
      fontFamily: {
        brand: ['Consolas', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
