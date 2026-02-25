const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "..", "docs", "assets", "icon.png");
const targetDir = path.join(__dirname, "..", "docs", "public");
const target = path.join(targetDir, "icon.png");

if (!fs.existsSync(source)) {
  console.error(`Missing docs logo source: ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Synced docs logo: ${source} -> ${target}`);
