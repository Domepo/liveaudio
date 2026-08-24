const http = require("node:http");

const targets = [
  ["api", Number(process.env.API_PORT || 3001)],
  ["media", Number(process.env.MEDIA_PORT || 4000)],
  ["web", Number(process.env.WEB_PORT || 5173)]
];
const startupGraceMs = Number(process.env.WATCHDOG_STARTUP_GRACE_MS || 45_000);
const intervalMs = Number(process.env.WATCHDOG_INTERVAL_MS || 10_000);
const failureThreshold = Number(process.env.WATCHDOG_FAILURE_THRESHOLD || 3);
let consecutiveFailures = 0;
let stopped = false;

function check(name, port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/health", timeout: 2_500 }, (response) => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else reject(new Error(`${name} returned HTTP ${response.statusCode}`));
    });
    request.on("timeout", () => request.destroy(new Error(`${name} timed out`)));
    request.on("error", reject);
  });
}

async function poll() {
  if (stopped) return;
  try {
    await Promise.all(targets.map(([name, port]) => check(name, port)));
    if (consecutiveFailures > 0) console.log("[watchdog] all services recovered");
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures += 1;
    console.error(`[watchdog] health failure ${consecutiveFailures}/${failureThreshold}: ${error.message}`);
    if (consecutiveFailures >= failureThreshold) {
      console.error("[watchdog] failure threshold reached; requesting container restart");
      process.exit(1);
    }
  }
  setTimeout(poll, intervalMs);
}

function shutdown() {
  stopped = true;
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
console.log(`[watchdog] starts in ${startupGraceMs}ms; threshold=${failureThreshold}`);
setTimeout(poll, startupGraceMs);
