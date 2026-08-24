function runtimeDefaultUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3001";

  const { hostname, origin, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3001`;
  }

  return origin;
}

export function runtimeApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  return runtimeDefaultUrl();
}

export function runtimeWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  return runtimeDefaultUrl();
}
