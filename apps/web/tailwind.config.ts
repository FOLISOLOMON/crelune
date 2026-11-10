import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        crelune: {
          primary: {
            DEFAULT: '#6541A5',
            hover: '#54348C',
            active: '#452A74',
            light: '#F2EDFA',
            subtle: '#EAE3F7',
          },
          lavender: {
            DEFAULT: '#A99AD1',
            light: '#D3CAEC',
            subtle: '#EFEBF8',
          },
          bg: '#F8F7FA',
          surface: '#FFFFFF',
          text: {
            DEFAULT: '#24212B',
            secondary: '#77727F',
            muted: '#9B96A4',
          },
          border: {
            DEFAULT: '#E8E5ED',
            subtle: '#F0EEF4',
          },
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
    },
  },
  plugins: [],
};

export default config;
