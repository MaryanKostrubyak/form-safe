import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./entrypoints/**/*.{html,ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#101828',
        mist: '#f6f8fb',
        brand: {
          50: '#eef8ff',
          100: '#d8efff',
          500: '#1685d9',
          600: '#0f6fb9',
          700: '#0d5c9a',
          900: '#0c4a6e',
          950: '#082f49',
        },
      },
      boxShadow: {
        panel: '0 16px 42px rgba(16, 24, 40, 0.12)',
        soft: '0 8px 24px rgba(16, 24, 40, 0.08)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
