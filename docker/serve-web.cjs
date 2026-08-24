const path = require("node:path");
const express = require("express");

const app = express();
const port = Number(process.env.WEB_PORT || 5173);
const host = process.env.WEB_HOST || "0.0.0.0";
const distDir = path.resolve(__dirname, "../apps/web/dist");

app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(
  express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  })
);
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(distDir, "index.html"));
});

const server = app.listen(port, host, () => {
  console.log(`[web] listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[web] received ${signal}, shutting down`);
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
