/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.prod.html",
    "./App.tsx",
    "./index.tsx",
  ],
  theme: {
    extend: {
      colors: {
        'cloudera-orange': '#F76D0B',
        'cloudera-deep-blue': '#191040',
        'cloudera-accent-blue': '#5448E4',
        'cloudera-card-bg': '#2A2058',
      }
    }
  },
  plugins: [],
}
