import { derived, get, writable } from "svelte/store";

import de from "./locales/de";
import en from "./locales/en";
import ru from "./locales/ru";
import uk from "./locales/uk";

export type Locale = "de" | "en" | "uk" | "ru";
type Dictionary = Record<string, string>;
type Params = Record<string, string | number>;

const STORAGE_KEY = "livevoice-lang";

const dictionaries: Record<Locale, Dictionary> = {
  de,
  en,
  uk,
  ru
};

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

function detectLocale(): Locale {
  const nav = (navigator.language || "de").toLowerCase();
  if (nav.startsWith("uk")) return "uk";
  if (nav.startsWith("ru")) return "ru";
  return nav.startsWith("en") ? "en" : "de";
}

function resolve(locale: Locale, key: string, params?: Params): string {
  const text = dictionaries[locale][key] ?? dictionaries.de[key] ?? key;
  return format(text, params);
}

export const locale = writable<Locale>("de");

export const t = derived(locale, ($locale) => {
  return (key: string, params?: Params): string => resolve($locale, key, params);
});

export function tr(key: string, params?: Params): string {
  return resolve(get(locale), key, params);
}

export function setLocale(nextLocale: Locale): void {
  locale.set(nextLocale);
  localStorage.setItem(STORAGE_KEY, nextLocale);
}

export function initLocale(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "de" || saved === "en" || saved === "uk" || saved === "ru") {
    locale.set(saved);
    return;
  }
  const detected = detectLocale();
  locale.set(detected);
  localStorage.setItem(STORAGE_KEY, detected);
}
