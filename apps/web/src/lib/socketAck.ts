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

export async function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response: { error?: string } & T) => {
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

