export const MEDIA_PERMISSION_TIMEOUT_MS = 12_000;

export async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs = MEDIA_PERMISSION_TIMEOUT_MS
): Promise<MediaStream> {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const mediaRequest = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    if (timedOut) {
      stream.getTracks().forEach((track) => track.stop());
    }
    return stream;
  });
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error("Mikrofonfreigabe hat zu lange gedauert. Bitte die Mikrofon-Berechtigung im Browser prüfen."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([mediaRequest, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
