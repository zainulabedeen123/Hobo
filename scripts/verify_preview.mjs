import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const screenshot = path.join(root, "preview.png");
const profile = path.join(root, ".chrome-preview");

if (!existsSync(chrome)) {
  throw new Error("Chrome is required for this optional visual check.");
}

const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.js"),
  server: {
    host: "127.0.0.1",
    port: 7100,
    strictPort: true,
    watch: { ignored: ["**/.chrome-preview/**"] },
  },
});

try {
  await server.listen();
  const response = await fetch("http://127.0.0.1:7100/");
  if (!response.ok) throw new Error(`Preview returned HTTP ${response.status}`);

  await new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--screenshot=${screenshot}`,
      "--window-size=1100,800",
      "--virtual-time-budget=1800",
      "http://127.0.0.1:7100/",
    ], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Chrome exited with ${code}`)));
  });

  const details = await stat(screenshot);
  console.log(`Visual preview saved: ${screenshot} (${details.size} bytes)`);
} finally {
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
