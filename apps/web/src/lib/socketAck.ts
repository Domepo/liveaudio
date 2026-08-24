import type { Socket } from "socket.io-client";

export async function waitForSocketConnect(socket: Socket, timeoutMs: number): Promise<void> {
  if (socket.connected) return;
  await new Promise<void>((resolve, reject) => {
    let lastError: unknown = null;
    const timer = setTimeout(() => {
      cleanup();
      reject(lastError instanceof Error ? lastError : new Error("Socket connect timeout"));
    }, timeoutMs);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (event: unknown) => {
      lastError = event;
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };
    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

export async function emitAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("disconnect", onDisconnect);
      callback();
    };
    const onDisconnect = (reason: string) => {
      finish(() => reject(new Error(`Socket getrennt während ${event}: ${reason}`)));
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Keine Server-Antwort auf ${event} nach ${Math.round(timeoutMs / 1_000)} Sekunden`)));
    }, timeoutMs);

    socket.once("disconnect", onDisconnect);
    socket.emit(event, payload, (response: ({ error?: string } & T) | undefined) => {
      if (response?.error) {
        finish(() => reject(new Error(response.error)));
        return;
      }
      if (!response) {
        finish(() => reject(new Error(`Leere Server-Antwort auf ${event}`)));
        return;
      }
      finish(() => resolve(response));
    });
  });
}
