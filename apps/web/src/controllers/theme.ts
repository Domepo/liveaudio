import { get } from "svelte/store";

import { app, type Theme } from "../stores/app";

export function applyTheme(nextTheme: Theme): void {
  app.update((s) => ({ ...s, theme: nextTheme }));
  document.documentElement.classList.toggle("dark", nextTheme === "dark");
  localStorage.setItem("livevoice-theme", nextTheme);
}

export function toggleTheme(): void {
  const state = get(app);
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

