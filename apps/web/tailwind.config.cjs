/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{svelte,ts,js}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1324",
        sky: "#e8f1ff",
        brand: "#0f766e",
        accent: "#d97706"
      },
      boxShadow: {
        soft: "0 14px 35px rgba(11, 19, 36, 0.12)"
      }
    }
  },
  plugins: []
};
