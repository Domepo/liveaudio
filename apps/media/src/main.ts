import "dotenv/config";
import { createApp } from "./app/create-app";
import { MEDIA_HOST, MEDIA_PORT, assertMediaSecurityConfig } from "./config/media";
import { registerRoutes } from "./http/register-routes";
import { initWorker } from "./services/worker.service";

async function start(): Promise<void> {
  assertMediaSecurityConfig();
  await initWorker();

  const app = createApp();
  registerRoutes(app);

  app.listen(MEDIA_PORT, MEDIA_HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Media service listening on ${MEDIA_HOST}:${MEDIA_PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
