import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */

// Cool, blue tinted neutrals. They replace the stock zinc scale so every
// existing neutral in the app picks up the "arctic night" tone.
const ink = {
  50: '#F3F6FB',
  100: '#E4EAF3',
  200: '#C9D3E2',
  300: '#A7B4C9',
  400: '#8593AC',
  500: '#6F7C95',
  600: '#4B576C',
  700: '#313B4E',
  800: '#1D2534',
  900: '#111723',
  950: '#0A0E17',
};

// The brand accent: glacier blue. It replaces the stock blue scale.
const ice = {
  50: '#EDFBFF',
  100: '#D6F5FF',
  200: '#ADEBFF',
  300: '#75DCFF',
  400: '#3CC8FA',
  500: '#16AEE8',
  600: '#0B8CC4',
  700: '#0C709E',
  800: '#105B80',
  900: '#134C6B',
  950: '#0A3048',
};

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        ink,
        ice,
        zinc: ink,
        blue: ice,
        // Softer profit and loss colours.
        red: colors.rose,
        green: colors.emerald,
        black: '#04060B',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        panel: 'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 24px 48px -32px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(117,220,255,0.28), 0 12px 36px -12px rgba(60,200,250,0.55)',
        'glow-sm': '0 0 20px -6px rgba(60,200,250,0.6)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        aurora: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(2%, -3%, 0) scale(1.08)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.8s linear infinite',
        aurora: 'aurora 18s ease-in-out infinite',
        blink: 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
