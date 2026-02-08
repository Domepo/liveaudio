import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "ontime.efgstadtoldendorf.de")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts
  }
});
