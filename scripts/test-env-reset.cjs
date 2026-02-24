const { execSync } = require("node:child_process");

function run(command) {
  // eslint-disable-next-line no-console
  console.log(`> ${command}`);
  execSync(command, { stdio: "inherit" });
}

function runMaybe(command, label) {
  try {
    run(command);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`${label} failed: ${error.message}`);
    return false;
  }
}

function maybeHealthcheck() {
  const urls = [
    process.env.API_HEALTH_URL,
    process.env.MEDIA_HEALTH_URL,
    process.env.WEB_HEALTH_URL
  ].filter(Boolean);

  if (urls.length === 0) return;

  for (const url of urls) {
    run(`node ./scripts/test-env-healthcheck.cjs ${url}`);
  }
}

if (process.env.SKIP_PRISMA_GENERATE !== "1") {
  const ok = runMaybe("npm run prisma:generate", "prisma:generate");
  if (!ok) {
    // one retry for transient file locks on Windows
    run("npm run prisma:generate");
  }
}
run("npm run db:init");
maybeHealthcheck();
