const path = require('path');

/** Compiled at build time (previously loaded from cdn.tailwindcss.com at runtime,
 *  which left the UI unstyled on offline / air-gapped sites). */
module.exports = {
  darkMode: 'class',
  content: [path.join(__dirname, 'index.html'), path.join(__dirname, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: '#090a0f',
          surface: '#111318',
          card: '#151821',
          border: 'rgba(255, 255, 255, 0.08)',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
};
