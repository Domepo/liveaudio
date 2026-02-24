import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test.describe.configure({ mode: "serial" });

const CREDENTIALS: {
  admin: { name: string; password: string };
  broadcaster: { name: string; password: string };
  viewer: { name: string; password: string };
} = {
  admin: { name: "admin", password: "test" },
  broadcaster: { name: "technik", password: "test" },
  viewer: { name: "media", password: "test" }
};

let createdSessionName = "";
let createdSessionCode = "";
let createdChannelName = "";
let createdSessionId = "";

function loadSeedUserName(seedUserId: string, fallback: string): string {
  const dbPath = path.join(process.cwd(), "prisma", "dev.db");
  const db = new DatabaseSync(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT "name" AS name FROM "User" WHERE "id" = ? LIMIT 1;').get(seedUserId) as { name?: unknown } | undefined;
    return typeof row?.name === "string" && row.name.trim().length > 0 ? row.name : fallback;
  } catch {
    return fallback;
  } finally {
    db.close();
  }
}

function loadSessionCode(sessionId: string, fallback: string): string {
  if (!sessionId) return fallback;
  const dbPath = path.join(process.cwd(), "prisma", "dev.db");
  const db = new DatabaseSync(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT "broadcastCode" AS code FROM "Session" WHERE "id" = ? LIMIT 1;').get(sessionId) as { code?: unknown } | undefined;
    return typeof row?.code === "string" && /^\d{6}$/.test(row.code) ? row.code : fallback;
  } catch {
    return fallback;
  } finally {
    db.close();
  }
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function installStableClientState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("livevoice-lang", "de");
  });
}

async function gotoAdminLogin(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.locator("#admin-name")).toBeVisible();
  await expect(page.locator("#admin-password")).toBeVisible();
}

async function maybeLogout(page: Page): Promise<void> {
  await page.goto("/login");
  const logoutButton = page.getByRole("button", { name: "Logout" }).first();
  if (await logoutButton.isVisible().catch(() => false)) {
    await logoutButton.click();
  }
  await expect(page.locator("#admin-name")).toBeVisible();
}

async function loginAs(page: Page, name: string, password: string): Promise<void> {
  await maybeLogout(page);
  await page.locator("#admin-name").fill(name);
  await page.locator("#admin-password").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator("#admin-name")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await installStableClientState(page);
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
});

test.beforeAll(() => {
  CREDENTIALS.admin.name = loadSeedUserName("dev-user-admin", CREDENTIALS.admin.name);
  CREDENTIALS.broadcaster.name = loadSeedUserName("dev-user-technik", CREDENTIALS.broadcaster.name);
  CREDENTIALS.viewer.name = loadSeedUserName("dev-user-media", CREDENTIALS.viewer.name);
});

test("login form validation and failed login status", async ({ page }) => {
  await gotoAdminLogin(page);

  const submitButton = page.getByRole("button", { name: "Anmelden" });
  await expect(submitButton).toBeDisabled();

  await page.locator("#admin-name").fill("admin");
  await expect(submitButton).toBeDisabled();

  await page.locator("#admin-password").fill("wrong-password");
  await expect(submitButton).toBeEnabled();

  await submitButton.click();
  await expect(page.getByText(/Fehler:/)).toBeVisible();
});

test("admin user management create, edit, delete", async ({ page }) => {
  const userName = uniqueId("e2e-user");
  const updatedUserName = `${userName}-edited`;

  await loginAs(page, CREDENTIALS.admin.name, CREDENTIALS.admin.password);
  await page.getByRole("button", { name: "Users" }).click();

  await page.getByRole("button", { name: "Neuer Nutzer" }).click();
  await page.locator("#create-user-name").fill(userName);
  await page.locator("#create-user-password").fill("Strong-pass-1!");
  await page.getByRole("button", { name: "Erstellen" }).click();

  const createdUserCard = page.locator("article", { hasText: userName }).first();
  await expect(createdUserCard).toBeVisible();

  await createdUserCard.getByRole("button", { name: "Bearbeiten" }).click();
  const editingCard = page.locator("article", { has: page.getByRole("button", { name: "Speichern" }) }).first();
  await editingCard.getByRole("textbox").first().fill(updatedUserName);
  await editingCard.getByRole("button", { name: "Speichern" }).click();

  const updatedUserCard = page.locator("article", { hasText: updatedUserName }).first();
  await expect(updatedUserCard).toBeVisible();

  await updatedUserCard.getByRole("button", { name: "Loeschen" }).click();
  await expect(page.locator("article", { hasText: updatedUserName })).toHaveCount(0);
});

test("admin session and channel flow with token rotation", async ({ page }) => {
  createdSessionName = uniqueId("E2E Session");
  createdChannelName = uniqueId("Kanal");

  await loginAs(page, CREDENTIALS.admin.name, CREDENTIALS.admin.password);
  await page.getByRole("button", { name: "Neue Session" }).click();

  await page.locator("#create-session-name").fill(createdSessionName);
  await page.locator("#create-session-description").fill("E2E Beschreibung");
  await page.getByRole("button", { name: "Erstellen" }).click();

  await expect(page).toHaveURL(/\/login\/sessions\/.+/);
  createdSessionId = page.url().split("/login/sessions/")[1]?.split(/[?#]/)[0] ?? "";
  await expect(page.getByRole("heading", { name: createdSessionName })).toBeVisible();

  await page.locator('input[placeholder="Deutsch"]:visible').first().fill(createdChannelName);
  await page.locator('input[placeholder="de / en"]:visible').first().fill("de");
  await page.getByRole("button", { name: "Channel hinzufuegen" }).click();
  await expect(page.locator(`p:visible:has-text("${createdChannelName}")`).first()).toBeVisible();

  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const sessionToken = page.locator("#session-token:visible").first();
  await expect(sessionToken).toHaveValue(/^\d{6}$/);
  await page.getByRole("button", { name: "Neu" }).click();
  await expect(sessionToken).toHaveValue(/^\d{6}$/);
  createdSessionCode = loadSessionCode(createdSessionId, await sessionToken.inputValue());
});

test("admin settings form and reset flow", async ({ page }) => {
  const settingsUrl = `https://join.e2e-${Date.now()}.example`;

  await loginAs(page, CREDENTIALS.admin.name, CREDENTIALS.admin.password);
  await page.getByRole("button", { name: "Settings" }).click();

  const joinUrlInput = page.locator("#settings-default-join-url");
  await joinUrlInput.fill(settingsUrl);
  await expect(joinUrlInput).toHaveValue(settingsUrl);

  await page.getByRole("button", { name: "Zuruecksetzen" }).click();
  await expect(joinUrlInput).toHaveValue("");
});

test("broadcaster role visibility and allowed actions", async ({ page }) => {
  await loginAs(page, CREDENTIALS.broadcaster.name, CREDENTIALS.broadcaster.password);

  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Neue Session" })).toBeVisible();

  await page.getByRole("button", { name: "Neue Session" }).click();
  await expect(page.locator("#create-session-name")).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.locator("#create-session-name")).toHaveCount(0);
});

test("viewer role visibility remains restricted", async ({ page }) => {
  await loginAs(page, CREDENTIALS.viewer.name, CREDENTIALS.viewer.password);

  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Neue Session" })).toHaveCount(0);
  await expect(page.getByText("Statistik").first()).toBeVisible();
});

test("listener token flow covers invalid and valid join", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#listener-token")).toBeVisible();

  await page.locator("#listener-token").fill("999999");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText(/Fehler:/)).toBeVisible();

  const validSeedToken = "100001";
  await page.locator("#listener-token").fill(validSeedToken);
  await page.getByRole("button", { name: "Weiter" }).click();

  await expect(page).toHaveURL(new RegExp(`\\/?\\?token=${validSeedToken}$`));
  await expect(page.getByRole("heading", { name: "Sonntag 09:30" })).toBeVisible();

  await page.getByRole("button", { name: "QR Code" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Schliessen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
