const http = require("node:http");

const targets = [
  ["api", Number(process.env.API_PORT || 3001)],
  ["media", Number(process.env.MEDIA_PORT || 4000)],
  ["web", Number(process.env.WEB_PORT || 5173)]
];

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

Promise.all(targets.map(([name, port]) => check(name, port))).catch((error) => {
  console.error(`[healthcheck] ${error.message}`);
  process.exit(1);
});
