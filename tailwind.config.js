/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        even: {
          blue: '#0055FF',
          navy: '#002054',
          white: '#FCFCFC',
          pink: '#F96EB1',
          green: '#22C55E',
          red: '#EF4444',
          orange: '#F97316',
          purple: '#8B5CF6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
