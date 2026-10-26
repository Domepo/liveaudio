import { Device } from "mediasoup-client";
import { get } from "svelte/store";
import { app } from "../../apps/web/src/stores/app";
import { setListenerAudioEl } from "../../apps/web/src/controllers/refs";
import { startListening, stopListening } from "../../apps/web/src/controllers/listener/playback";
import { listenerSocket } from "../../apps/web/src/controllers/runtime";

export async function produce(data: any): Promise<void> {
  const device = new Device();
  await device.load({ routerRtpCapabilities: data.rtpCapabilities });
  const transport = device.createSendTransport(data);
  transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    try {
      await (window as any).connectProducer(dtlsParameters);
      callback();
    } catch (error) { errback(error as Error); }
  });
  transport.on("produce", async ({ rtpParameters }, callback, errback) => {
    try { callback({ id: await (window as any).createProducer(rtpParameters) }); }
    catch (error) { errback(error as Error); }
  });
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  oscillator.frequency.value = 440;
  oscillator.connect(destination);
  oscillator.start();
  await transport.produce({ track: destination.stream.getAudioTracks()[0] });
  (window as any).testProducer = { context, oscillator, transport };
}

export async function listen(): Promise<void> {
  const audio = document.createElement("audio");
  audio.controls = true;
  document.body.append(audio);
  setListenerAudioEl(audio);
  app.update((state) => ({
    ...state,
    listenerCode: "123456",
    listenerSessionId: "background-test-session",
    listenerSessionName: "Background test",
    listenerChannels: [{ id: "background-test-channel", name: "Deutsch" } as any],
    selectedChannelId: "background-test-channel"
  }));
  await startListening();
}

export function status(): { listening: boolean; paused: boolean; hasStream: boolean } {
  const audio = document.querySelector("audio")!;
  return { listening: get(app).isListening, paused: audio.paused, hasStream: Boolean(audio.srcObject) };
}

export { stopListening };

export function isSignalingConnected(): boolean {
  return Boolean(listenerSocket?.connected);
}
