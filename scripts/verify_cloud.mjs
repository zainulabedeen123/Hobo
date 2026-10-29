import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!existsSync(chrome)) throw new Error("Chrome is required for the cloud end-to-end test.");

const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.js"),
  server: { host: "127.0.0.1", port: 7100, strictPort: true },
  logLevel: "error",
});
let browser;
let page;
const password = `${randomBytes(18).toString("base64url")}aA1`;
const stamp = Date.now();
const firstEmail = `hobo.e2e.first.${stamp}@example.com`;
const secondEmail = `hobo.e2e.second.${stamp}@example.com`;
const uniqueTask = `Neon sync verification ${stamp}`;

try {
  await server.listen();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto("http://127.0.0.1:7100/", { waitUntil: "networkidle" });

  async function currentUser() {
    return page.evaluate(async () => (await import("/src/auth.js")).getCurrentUser());
  }
  async function cloudTasks() {
    return page.evaluate(async () => (await import("/src/cloud.js")).listCloudTasks());
  }
  async function waitSynced() {
    await page.waitForFunction(() => document.querySelector(".storage-label")?.textContent === "Cloud sync on");
  }
  async function waitAuthCompletion() {
    await page.waitForFunction(() => {
      const panel = document.querySelector(".account-panel");
      return panel?.hidden || document.querySelector(".account-error:not([hidden])") || document.querySelector('.account-sync-status[data-state="error"]');
    });
    const error = page.locator(".account-error:not([hidden]), .account-sync-status[data-state='error']");
    if (await error.count()) throw new Error(await error.first().textContent());
    await waitSynced();
  }
  async function createAccount(email, name) {
    await page.locator(".account-button").click();
    await page.locator('[data-mode="sign-up"]').click();
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator(".account-submit").click();
    await waitAuthCompletion();
  }
  async function signIn(email) {
    await page.locator(".account-button").click();
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator(".account-submit").click();
    await waitAuthCompletion();
  }
  async function signOut() {
    await page.locator(".account-button").click();
    await page.locator(".account-signout").click();
    await page.locator(".account-form").waitFor({ state: "visible" });
    assert.equal(await currentUser(), null);
    await page.locator(".account-close").click();
  }

  await createAccount(firstEmail, "Hobo Test One");
  const firstUser = await currentUser();
  assert.equal(firstUser.email, firstEmail);
  console.log("PASS: real sign-up and current-user readback");

  const syncResponse = page.waitForResponse((response) =>
    response.url().includes("/tasks/sync") && response.request().method() === "PUT" && response.ok());
  await page.locator("#new-task").fill(uniqueTask);
  await page.locator(".add-button").click();
  await syncResponse;
  assert.ok((await cloudTasks()).some((task) => task.text === uniqueTask));
  console.log("PASS: authenticated task sync and protected API readback");

  await page.reload({ waitUntil: "networkidle" });
  await waitSynced();
  assert.equal((await currentUser()).id, firstUser.id);
  console.log("PASS: session restoration after reload");

  await signOut();
  console.log("PASS: sign-out clears the active session");

  await signIn(firstEmail);
  assert.equal((await currentUser()).id, firstUser.id);
  assert.ok((await cloudTasks()).some((task) => task.text === uniqueTask));
  console.log("PASS: email/password sign-in restores the same user and tasks");

  await signOut();
  await createAccount(secondEmail, "Hobo Test Two");
  const secondUser = await currentUser();
  assert.notEqual(secondUser.id, firstUser.id);
  assert.ok(!(await cloudTasks()).some((task) => task.text === uniqueTask));
  console.log("PASS: a second account cannot read the first account's tasks");
  console.log(`Cloud end-to-end verification complete for user IDs ${firstUser.id} and ${secondUser.id}.`);
} catch (error) {
  console.error(`Cloud verification failed: ${error.message}`);
  if (page) {
    const accountError = page.locator(".account-error:visible");
    if (await accountError.count()) console.error(`Account error: ${await accountError.textContent()}`);
    const toast = page.locator(".toast.visible");
    if (await toast.count()) console.error(`Sync error: ${await toast.textContent()}`);
    const tokenInfo = await page.evaluate(async () => {
      const { authClient } = await import("/src/auth.js");
      const result = await authClient.token();
      return { dataKeys: Object.keys(result.data || {}), hasToken: Boolean(result.data?.token), error: result.error || null };
    }).catch((error) => ({ evaluationError: error.message }));
    console.error(`Token diagnostics: ${JSON.stringify(tokenInfo)}`);
    await page.screenshot({ path: path.join(root, ".tmp", "cloud-e2e-failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
