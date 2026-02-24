const url = process.argv[2];

if (!url) {
  // eslint-disable-next-line no-console
  console.error("Missing URL argument");
  process.exit(1);
}

const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 20_000);
const started = Date.now();

async function waitForHealthy() {
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        // eslint-disable-next-line no-console
        console.log(`Healthy: ${url}`);
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Healthcheck timed out for ${url}`);
}

waitForHealthy().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
