import { HttpError } from "./errors";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init
  });
  const raw = await response.text();
  let body: unknown = {};

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      if (!response.ok) {
        throw new HttpError(`Request failed (${response.status})`, response.status, url, raw);
      }
      throw new Error("Server returned invalid JSON");
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof body === "object" && body !== null && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${response.status})`;
    throw new HttpError(errorMessage, response.status, url, body);
  }

  return (body as T) ?? ({} as T);
}

