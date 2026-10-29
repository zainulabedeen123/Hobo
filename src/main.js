import "./style.css";
import { createAccountController } from "./account.js";
import { authConfigured } from "./auth.js";
import { listCloudTasks, syncCloudTasks } from "./cloud.js";
import bunnyUrl from "./assets/dayfly-bunny.png";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri = Boolean(window.__TAURI_INTERNALS__);
const storageKey = "dayfly.web.tasks.v1";
let tasks = [];
let activeFilter = "all";

const icons = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
};

document.querySelector("#app").innerHTML = `
  <button class="reopen-button" type="button" hidden>
    ${icons.spark}<span>Open Hobo</span><kbd>⌃ ⇧ Space</kbd>
  </button>

  <section class="flyout" aria-label="Hobo to-do list">
    <div class="ambient-glow"></div>
    <header class="flyout-header" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <span class="brand-mark"><img class="brand-bunny" src="${bunnyUrl}" alt="" draggable="false" /></span>
        <div>
          <h1>Hobo</h1>
          <p class="today-label"></p>
        </div>
      </div>
      <div class="window-controls">
        <button class="icon-button minimize-button" type="button" aria-label="Minimize Hobo" title="Minimize (Ctrl/Command + Shift + Space to reopen)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>
        </button>
        <button class="icon-button close-button" type="button" aria-label="Close Hobo" title="Close Hobo">${icons.close}</button>
      </div>
    </header>

    <div class="content">
      <section class="overview" aria-label="Today's progress">
        <div class="overview-copy">
          <div>
            <span class="eyebrow">TODAY'S FOCUS</span>
            <p class="task-summary">A clear day starts here.</p>
          </div>
          <strong class="progress-number">0%</strong>
        </div>
        <div class="progress-track" role="progressbar" aria-label="Tasks completed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="progress-fill"></span>
        </div>
      </section>

      <form class="quick-add" autocomplete="off">
        <label class="sr-only" for="new-task">Add a task</label>
        <input id="new-task" name="task" type="text" maxlength="240" placeholder="What needs doing?" spellcheck="false" />
        <label class="sr-only" for="new-task-tag">Tag for new task</label>
        <select id="new-task-tag" class="quick-tag" data-tag="" title="Optional tag">
          <option value="">No tag</option>
          <option value="urgent">Urgent</option>
          <option value="work">Work</option>
          <option value="personal">Personal</option>
        </select>
        <button class="add-button" type="submit" aria-label="Add task" title="Add task">${icons.plus}</button>
      </form>
      <p class="input-hint">Press <kbd>Enter</kbd> to add — stay in your flow.</p>

      <div class="list-toolbar">
        <div class="filters" role="group" aria-label="Filter tasks">
          <button class="filter active" type="button" data-filter="all">All</button>
          <button class="filter" type="button" data-filter="active">Active</button>
          <button class="filter" type="button" data-filter="done">Done</button>
        </div>
        <button class="clear-button" type="button" hidden>Clear done</button>
      </div>

      <ul class="task-list" aria-live="polite"></ul>
      <div class="empty-state" hidden>
        <span class="empty-icon">${icons.check}</span>
        <h2></h2>
        <p></p>
      </div>
    </div>

    <footer class="flyout-footer">
      <button class="privacy account-button" type="button" hidden><i></i><span class="storage-label">Saved on this device</span></button>
      <span class="privacy local-privacy"><i></i><span>Saved on this device</span></span>
      <span class="shortcut-hint"><kbd class="primary-shortcut">Ctrl</kbd><kbd>Shift</kbd><kbd>Space</kbd></span>
    </footer>
    <div class="toast" role="status" aria-live="polite"></div>
  </section>
`;

const elements = {
  flyout: document.querySelector(".flyout"),
  reopen: document.querySelector(".reopen-button"),
  form: document.querySelector(".quick-add"),
  input: document.querySelector("#new-task"),
  list: document.querySelector(".task-list"),
  empty: document.querySelector(".empty-state"),
  summary: document.querySelector(".task-summary"),
  progressNumber: document.querySelector(".progress-number"),
  progressTrack: document.querySelector(".progress-track"),
  progressFill: document.querySelector(".progress-fill"),
  clear: document.querySelector(".clear-button"),
  toast: document.querySelector(".toast"),
};

const formatDate = () =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

document.querySelector(".today-label").textContent = formatDate();
if (navigator.userAgent.toLowerCase().includes("mac")) {
  document.querySelector(".primary-shortcut").textContent = "⌘";
  document.querySelector(".reopen-button kbd").textContent = "⌘ ⇧ Space";
}
if (!isTauri) {
  document.body.classList.add("web-preview");
  document.querySelector(".storage-label").textContent = "Browser demo · saved locally";
}

function seedTasks() {
  const now = Date.now();
  return [
    { id: crypto.randomUUID(), text: "Review the product roadmap", completed: false, createdAt: now, tag: "urgent" },
    { id: crypto.randomUUID(), text: "Reply to Alex's design feedback", completed: false, createdAt: now - 1, tag: "work" },
    { id: crypto.randomUUID(), text: "Book a table for Friday dinner", completed: true, createdAt: now - 2, tag: "personal" },
  ];
}

function readWebTasks() {
  const stored = localStorage.getItem(storageKey);
  if (stored === null) {
    const initial = seedTasks();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map((task) => ({ ...task, tag: task.tag || "" })) : [];
  } catch {
    return [];
  }
}

function writeWebTasks(nextTasks) {
  localStorage.setItem(storageKey, JSON.stringify(nextTasks));
  return nextTasks;
}

const repository = {
  async list() {
    return isTauri ? invoke("list_tasks") : readWebTasks();
  },
  async add(text, tag) {
    if (!isTauri) {
      const next = readWebTasks();
      next.unshift({ id: crypto.randomUUID(), text, completed: false, createdAt: Date.now(), tag });
      return writeWebTasks(next);
    }
    return invoke("add_task", { text, tag });
  },
  async toggle(id) {
    if (!isTauri) {
      return writeWebTasks(readWebTasks().map((task) => task.id === id ? { ...task, completed: !task.completed, timerEndsAt: null } : task));
    }
    return invoke("toggle_task", { id });
  },
  async setTag(id, tag) {
    if (!isTauri) {
      return writeWebTasks(readWebTasks().map((task) => task.id === id ? { ...task, tag } : task));
    }
    return invoke("set_task_tag", { id, tag });
  },
  async setTimer(id, minutes) {
    if (!isTauri) {
      return writeWebTasks(readWebTasks().map((task) => task.id === id ? {
        ...task,
        timerEndsAt: minutes > 0 ? Date.now() + minutes * 60_000 : null,
      } : task));
    }
    return invoke("set_task_timer", { id, minutes });
  },
  async reorder(ids) {
    if (!isTauri) {
      const current = readWebTasks();
      return writeWebTasks(ids.map((id) => current.find((task) => task.id === id)).filter(Boolean));
    }
    return invoke("reorder_tasks", { ids });
  },
  async delete(id) {
    if (!isTauri) {
      return writeWebTasks(readWebTasks().filter((task) => task.id !== id));
    }
    return invoke("delete_task", { id });
  },
  async clearCompleted() {
    if (!isTauri) {
      return writeWebTasks(readWebTasks().filter((task) => !task.completed));
    }
    return invoke("clear_completed");
  },
  async replaceAll(nextTasks) {
    if (!isTauri) return writeWebTasks(nextTasks);
    return invoke("replace_tasks", { tasks: nextTasks });
  },
};

let activeUser = null;
let cloudSyncQueue = Promise.resolve();
let account;

function queueCloudSync() {
  if (!activeUser) return Promise.resolve();
  const userId = activeUser.id;
  const pendingKey = `hobo.cloud.pending.${userId}`;
  const snapshot = tasks.map((task) => ({ ...task }));
  localStorage.setItem(pendingKey, "true");
  account?.setSyncState("syncing");
  cloudSyncQueue = cloudSyncQueue.catch(() => {}).then(async () => {
    if (activeUser?.id !== userId) throw new Error("Account changed before sync completed.");
    await syncCloudTasks(snapshot);
    localStorage.removeItem(pendingKey);
    if (activeUser?.id === userId) account?.setSyncState("synced");
  });
  return cloudSyncQueue;
}

async function connectCloud(user, { forceDownload = false } = {}) {
  activeUser = user;
  account?.setSyncState("syncing");
  await cloudSyncQueue.catch(() => {});
  const cloudTasks = await listCloudTasks();
  const initializedKey = `hobo.cloud.initialized.${user.id}`;
  const pendingKey = `hobo.cloud.pending.${user.id}`;
  const hasSyncedHere = localStorage.getItem(initializedKey) === "true";
  const hasPendingSync = localStorage.getItem(pendingKey) === "true";
  const lastUserId = localStorage.getItem("hobo.cloud.lastUserId");
  const sameLocalOwner = !lastUserId || lastUserId === user.id;
  const shouldUpload = !forceDownload && sameLocalOwner && (hasPendingSync || !hasSyncedHere);

  if (shouldUpload) {
    let nextTasks = tasks;
    if (!hasSyncedHere && cloudTasks.length > 0) {
      const cloudIds = new Set(cloudTasks.map((task) => task.id));
      nextTasks = [...cloudTasks, ...tasks.filter((task) => !cloudIds.has(task.id))];
    }
    if (nextTasks.length > 500) throw new Error("Hobo can sync up to 500 tasks per account.");
    tasks = await syncCloudTasks(nextTasks);
  } else {
    tasks = await repository.replaceAll(cloudTasks);
  }
  localStorage.removeItem(pendingKey);
  localStorage.setItem(initializedKey, "true");
  localStorage.setItem("hobo.cloud.lastUserId", user.id);
  render();
  account?.setSyncState("synced");
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

let draggedTaskId = null;

function moveTaskBy(id, direction) {
  const next = tasks.map((task) => task.id);
  const index = next.indexOf(id);
  const destination = Math.max(0, Math.min(next.length - 1, index + direction));
  if (index < 0 || index === destination) return;
  [next[index], next[destination]] = [next[destination], next[index]];
  mutate(() => repository.reorder(next));
}

function createTaskElement(task) {
  const item = document.createElement("li");
  item.className = `task-item${task.completed ? " completed" : ""}`;
  item.dataset.id = task.id;
  item.draggable = activeFilter === "all";

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "drag-handle";
  handle.disabled = activeFilter !== "all";
  handle.setAttribute("aria-label", `Reorder “${task.text}”. Drag or use the up and down arrow keys.`);
  handle.title = activeFilter === "all" ? "Drag to reorder · Arrow keys to move" : "Switch to All to reorder";
  handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>';
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTaskBy(task.id, event.key === "ArrowUp" ? -1 : 1);
    }
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "task-toggle";
  toggle.setAttribute("aria-label", task.completed ? `Mark “${task.text}” as active` : `Mark “${task.text}” as done`);
  toggle.setAttribute("aria-pressed", String(task.completed));
  toggle.innerHTML = icons.check;
  toggle.addEventListener("click", () => mutate(() => repository.toggle(task.id)));

  const body = document.createElement("div");
  body.className = "task-body";
  const text = document.createElement("p");
  text.className = "task-text";
  text.textContent = task.text;
  text.title = task.text;

  const tagSelect = document.createElement("select");
  tagSelect.className = "task-tag";
  tagSelect.dataset.tag = task.tag || "";
  tagSelect.setAttribute("aria-label", `Tag for “${task.text}”`);
  [["", "+ Tag"], ["urgent", "Urgent"], ["work", "Work"], ["personal", "Personal"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = (task.tag || "") === value;
    tagSelect.append(option);
  });
  tagSelect.addEventListener("mousedown", (event) => event.stopPropagation());
  tagSelect.addEventListener("change", () => mutate(() => repository.setTag(task.id, tagSelect.value)));

  const timerSelect = document.createElement("select");
  const timerActive = Boolean(task.timerEndsAt && task.timerEndsAt > Date.now());
  timerSelect.className = "task-timer";
  timerSelect.dataset.taskId = task.id;
  timerSelect.dataset.active = String(timerActive);
  timerSelect.setAttribute("aria-label", `Timer for “${task.text}”`);
  timerSelect.title = timerActive ? "Countdown running · Choose Clear timer to stop" : "Start a countdown";
  if (timerActive) {
    const current = document.createElement("option");
    current.value = "active";
    current.className = "timer-current";
    current.textContent = formatTimer(task);
    current.selected = true;
    timerSelect.append(current);
  }
  const timerOption = document.createElement("option");
  timerOption.value = "0";
  timerOption.textContent = timerActive ? "Clear timer" : "+ Timer";
  timerOption.selected = !timerActive;
  timerSelect.append(timerOption);
  [1, 5, 10, 25, 45, 60].forEach((minutes) => {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = `${minutes} min`;
    timerSelect.append(option);
  });
  timerSelect.addEventListener("mousedown", (event) => event.stopPropagation());
  timerSelect.addEventListener("change", () => {
    if (timerSelect.value !== "active") {
      mutate(() => repository.setTimer(task.id, Number(timerSelect.value)));
    }
  });

  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.append(tagSelect, timerSelect);
  body.append(text, meta);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-task";
  remove.setAttribute("aria-label", `Delete “${task.text}”`);
  remove.title = "Delete task";
  remove.innerHTML = icons.trash;
  remove.addEventListener("click", () => mutate(() => repository.delete(task.id)));

  item.addEventListener("dragstart", (event) => {
    if (activeFilter !== "all" || event.target.closest("select, .task-toggle, .delete-task")) {
      event.preventDefault();
      return;
    }
    draggedTaskId = task.id;
    item.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  });
  item.addEventListener("dragover", (event) => {
    if (!draggedTaskId || draggedTaskId === task.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
    item.classList.toggle("drop-after", after);
    item.classList.toggle("drop-before", !after);
  });
  item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
  item.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!draggedTaskId || draggedTaskId === task.id) return;
    const after = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
    const next = tasks.map((entry) => entry.id);
    next.splice(next.indexOf(draggedTaskId), 1);
    const targetIndex = next.indexOf(task.id);
    next.splice(targetIndex + (after ? 1 : 0), 0, draggedTaskId);
    draggedTaskId = null;
    mutate(() => repository.reorder(next));
  });
  item.addEventListener("dragend", () => {
    draggedTaskId = null;
    document.querySelectorAll(".task-item").forEach((entry) => entry.classList.remove("dragging", "drop-before", "drop-after"));
  });

  item.append(handle, toggle, body, remove);
  return item;
}

function render() {
  const completed = tasks.filter((task) => task.completed).length;
  const active = tasks.length - completed;
  const percentage = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  elements.summary.textContent = tasks.length === 0
    ? "A clear day starts here."
    : active === 0
      ? "Everything is done. Nice work!"
      : `${active} ${active === 1 ? "task" : "tasks"} left · ${completed} done`;
  elements.progressNumber.textContent = `${percentage}%`;
  elements.progressFill.style.width = `${percentage}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(percentage));
  elements.clear.hidden = completed === 0;

  const visibleTasks = tasks.filter((task) => {
    if (activeFilter === "active") return !task.completed;
    if (activeFilter === "done") return task.completed;
    return true;
  });

  elements.list.replaceChildren(...visibleTasks.map(createTaskElement));
  elements.list.hidden = visibleTasks.length === 0;
  elements.empty.hidden = visibleTasks.length !== 0;

  if (visibleTasks.length === 0) {
    const emptyTitle = elements.empty.querySelector("h2");
    const emptyCopy = elements.empty.querySelector("p");
    if (activeFilter === "done") {
      emptyTitle.textContent = "Nothing finished yet";
      emptyCopy.textContent = "Completed tasks will collect here.";
    } else if (activeFilter === "active") {
      emptyTitle.textContent = "You're all caught up";
      emptyCopy.textContent = "Enjoy the breathing room.";
    } else {
      emptyTitle.textContent = "Make space for today";
      emptyCopy.textContent = "Add your first task above. No account, no clutter.";
    }
  }
}

async function mutate(action) {
  try {
    tasks = await action();
    render();
    if (activeUser) {
      try {
        await queueCloudSync();
      } catch {
        account?.setSyncState("error");
        showToast("Saved on this device. Cloud sync will retry from your account panel.");
      }
    }
  } catch (error) {
    showToast(typeof error === "string" ? error : "Something went wrong. Please try again.");
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.input.value.trim();
  if (!text) {
    elements.form.classList.remove("shake");
    requestAnimationFrame(() => elements.form.classList.add("shake"));
    elements.input.focus();
    return;
  }

  const quickTag = document.querySelector("#new-task-tag");
  const button = elements.form.querySelector("button");
  button.disabled = true;
  await mutate(() => repository.add(text, quickTag.value));
  button.disabled = false;
  elements.input.value = "";
  quickTag.value = "";
  quickTag.dataset.tag = "";
  elements.input.focus();
});

document.querySelector("#new-task-tag").addEventListener("change", (event) => {
  event.target.dataset.tag = event.target.value;
});

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

elements.clear.addEventListener("click", () => mutate(() => repository.clearCompleted()));

async function hideFlyout() {
  if (isTauri) {
    await getCurrentWindow().hide();
    return;
  }
  elements.flyout.classList.add("is-hidden");
  elements.reopen.hidden = false;
}

async function minimizeFlyout() {
  if (isTauri) {
    await invoke("minimize_to_mini");
    return;
  }
  hideFlyout();
}

async function closeFlyout() {
  if (isTauri) {
    await getCurrentWindow().close();
    return;
  }
  hideFlyout();
}

function showFlyout() {
  elements.flyout.classList.remove("is-hidden");
  elements.reopen.hidden = true;
  requestAnimationFrame(() => elements.input.focus());
}

document.querySelector(".minimize-button").addEventListener("click", minimizeFlyout);
document.querySelector(".close-button").addEventListener("click", closeFlyout);
elements.reopen.addEventListener("click", showFlyout);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideFlyout();
  }
  if (!isTauri && event.code === "Space" && event.shiftKey && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    elements.flyout.classList.contains("is-hidden") ? showFlyout() : hideFlyout();
  }
});

function formatTimer(task) {
  const totalSeconds = Math.max(0, Math.ceil((task.timerEndsAt - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateTimerDisplays() {
  document.querySelectorAll(".task-timer[data-active=\"true\"]").forEach((select) => {
    const task = tasks.find((entry) => entry.id === select.dataset.taskId);
    const current = select.querySelector(".timer-current");
    if (task && current) current.textContent = formatTimer(task);
  });
}

setInterval(() => {
  updateTimerDisplays();
  if (!isTauri) {
    const expired = tasks.filter((task) => task.timerEndsAt && task.timerEndsAt <= Date.now());
    if (expired.length) {
      const expiredIds = new Set(expired.map((task) => task.id));
      tasks = writeWebTasks(tasks.map((task) => expiredIds.has(task.id) ? { ...task, timerEndsAt: null } : task));
      render();
      queueCloudSync().catch(() => account?.setSyncState("error"));
      showToast(`Timer finished: ${expired[0].text}`);
    }
  }
}, 1000);

if (isTauri) {
  getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) elements.input.focus();
  });
  await listen("tasks-updated", (event) => {
    tasks = event.payload;
    render();
  });
}

if (authConfigured) document.body.classList.add("cloud-enabled");
account = createAccountController({
  root: elements.flyout,
  button: document.querySelector(".account-button"),
  onAuthenticated: connectCloud,
  onSignedOut: () => {
    activeUser = null;
  },
  onError: (error) => showToast(error.message || "Cloud account action failed."),
});

tasks = await repository.list();
render();
void account.initialize();
if (!isTauri) {
  setTimeout(() => elements.input.focus(), 350);
}
