/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#090d16',
          card: '#111827',
          border: '#1f2937',
          cyan: '#4fc3f7',
          amber: '#fb923c',
        }
      }
    },
  },
  plugins: [],
}
