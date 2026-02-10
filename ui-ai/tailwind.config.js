export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        background: '#0b1120',
        surface: '#111827',
        accent: '#38bdf8',
        accentSecondary: '#818cf8'
      },
      boxShadow: {
        glow: '0 8px 25px rgba(15, 23, 42, 0.35)'
      }
    }
  },
  plugins: []
};

