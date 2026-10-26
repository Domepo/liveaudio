import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/webrtc/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      MEDIA_LISTEN_IP: "127.0.0.1",
      MEDIA_ANNOUNCED_IP: "127.0.0.1",
      RTC_MIN_PORT: "45400",
      RTC_MAX_PORT: "45500"
    }
  }
});
