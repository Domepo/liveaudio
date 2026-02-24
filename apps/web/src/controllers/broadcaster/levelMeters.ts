import { app } from "../../stores/app";
import {
  channelAnalyzers,
  meterAnimationId,
  meterAudioContext,
  setMeterAnimationId,
  setMeterAudioContext
} from "../runtime";

export function stopLevelMeters(clearLevels = true): void {
  if (meterAnimationId !== null) {
    cancelAnimationFrame(meterAnimationId);
    setMeterAnimationId(null);
  }
  for (const meter of channelAnalyzers.values()) {
    meter.source.disconnect();
  }
  channelAnalyzers.clear();
  if (meterAudioContext) {
    void meterAudioContext.close();
    setMeterAudioContext(null);
  }
  if (clearLevels) {
    app.update((s) => ({ ...s, channelDbLevels: {} }));
  }
}

export function startLevelMeterLoop(): void {
  if (meterAnimationId !== null) return;

  const update = () => {
    const nextLevels: Record<string, number> = {};
    for (const [channelId, meter] of channelAnalyzers.entries()) {
      meter.analyser.getByteTimeDomainData(meter.dataArray);
      let sum = 0;
      for (const value of meter.dataArray) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / meter.dataArray.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      nextLevels[channelId] = Number(Math.max(-60, Math.min(0, db)).toFixed(1));
    }
    app.update((s) => ({ ...s, channelDbLevels: nextLevels }));
    setMeterAnimationId(requestAnimationFrame(update));
  };

  setMeterAnimationId(requestAnimationFrame(update));
}

export async function attachLevelMeter(channelId: string, stream: MediaStream): Promise<void> {
  let ctx = meterAudioContext;
  if (!ctx) {
    ctx = new AudioContext();
    setMeterAudioContext(ctx);
  }
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const dataArray = new Uint8Array(analyser.fftSize);
  source.connect(analyser);
  channelAnalyzers.set(channelId, { analyser, dataArray, source });
  startLevelMeterLoop();
}
