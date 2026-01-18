/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{html,tsx,ts}"],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: "rgba(17, 24, 39, 0.95)",
          border: "rgba(55, 65, 81, 0.5)"
        },
        status: {
          active: "#4ade80",
          working: "#facc15",
          waiting: "#60a5fa",
          permission: "#f97316",
          error: "#ef4444",
          idle: "#6b7280"
        }
      },
      animation: {
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
      }
    }
  },
  plugins: []
}
