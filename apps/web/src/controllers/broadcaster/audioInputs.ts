import { get } from "svelte/store";

import { tr } from "../../i18n";
import { getUserMediaWithTimeout } from "../../lib/media";
import { app } from "../../stores/app";
import type { AudioInput } from "../../types/channel";
import { setStatus } from "../logging";
import { syncChannelAssignments } from "../channels";

export async function refreshAudioInputs(requestPermission = false): Promise<boolean> {
  try {
    if (requestPermission) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia unavailable");
      }
      const stream = await getUserMediaWithTimeout({ audio: true, video: false });
      const track = stream.getAudioTracks()[0];
      if (!navigator.mediaDevices?.enumerateDevices) {
        const inputs: AudioInput[] = [{ deviceId: track?.getSettings().deviceId || "default", label: track?.label || "Mikrofon" }];
        app.update((s) => ({ ...s, audioInputs: inputs }));
        syncChannelAssignments(get(app).channels);
        stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        return true;
      }
      stream.getTracks().forEach((t) => t.stop());
    }

    if (!navigator.mediaDevices?.enumerateDevices) {
      app.update((s) => ({ ...s, audioInputs: [] }));
      const secureHint = window.isSecureContext ? "" : ` ${tr("status.audio_secure_hint")}`;
      setStatus("broadcaster", `${tr("status.audio_devices_unavailable")}${secureHint}`);
      return false;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs: AudioInput[] = devices
      .filter((d) => d.kind === "audioinput")
      .map((d, index) => ({ deviceId: d.deviceId, label: d.label || `Audio Input ${index + 1}` }));

    app.update((s) => ({ ...s, audioInputs: inputs }));
    syncChannelAssignments(get(app).channels);
    return true;
  } catch (error) {
    const secureHint = window.isSecureContext ? "" : ` (${tr("status.audio_mic_hint")})`;
    setStatus("broadcaster", tr("status.audio_devices_error", { message: `${(error as Error).message}${secureHint}` }));
    return false;
  }
}
