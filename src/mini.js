import "./mini.css";
import bunnyUrl from "./assets/dayfly-bunny.png";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const currentWindow = getCurrentWindow();

function updateCount(count) {
  const label = count > 99 ? "99+" : String(count);
  document.querySelector(".mini-count").textContent = label;
  document.querySelector(".mini-launcher").setAttribute(
    "aria-label",
    `${count} remaining ${count === 1 ? "task" : "tasks"}. Open Hobo.`,
  );
  document.querySelector(".mini-launcher").title = `${count} remaining · Click to open · Drag to move`;
}

document.querySelector("#app").innerHTML = `
  <button class="mini-launcher" type="button">
    <img class="mini-bunny" src="${bunnyUrl}" alt="" draggable="false" />
    <span class="mini-count">0</span>
  </button>
`;

const launcher = document.querySelector(".mini-launcher");
let pointerStart = null;
let dragging = false;

launcher.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerStart = { x: event.screenX, y: event.screenY };
  dragging = false;
});

launcher.addEventListener("pointermove", async (event) => {
  if (!pointerStart || dragging) return;
  const distance = Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y);
  if (distance > 6) {
    dragging = true;
    await currentWindow.startDragging();
  }
});

launcher.addEventListener("pointerup", () => {
  pointerStart = null;
});
launcher.addEventListener("pointercancel", () => {
  pointerStart = null;
  dragging = false;
});

launcher.addEventListener("click", async () => {
  await invoke("restore_main");
});

await listen("tasks-changed", (event) => updateCount(Number(event.payload)));
const tasks = await invoke("list_tasks");
updateCount(tasks.filter((task) => !task.completed).length);
