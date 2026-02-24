export function runtimeApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window === "undefined") return "http://localhost:3001";
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

export function runtimeWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (typeof window === "undefined") return "http://localhost:3001";
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}
