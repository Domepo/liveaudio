const { spawn } = require("node:child_process");

const child = spawn("npm run dev -w @livevoice/api", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DEBUG_MODE: "1" }
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
