import { getAccessToken } from "./auth.js";

const apiUrl = (import.meta.env.VITE_TASK_API_URL || "").replace(/\/$/, "");

async function request(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON error is handled by the generic message below.
  }
  if (!response.ok) {
    const error = new Error(body?.error || `Cloud sync failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function listCloudTasks() {
  const body = await request("/tasks");
  if (!Array.isArray(body?.tasks)) throw new Error("The cloud returned an invalid task list.");
  return body.tasks;
}

export async function syncCloudTasks(tasks) {
  const normalizedTasks = tasks.map((task) => ({
    id: task.id,
    text: task.text,
    completed: Boolean(task.completed),
    tag: task.tag || "",
    timerEndsAt: task.timerEndsAt ?? null,
    createdAt: task.createdAt,
  }));
  const body = await request("/tasks/sync", {
    method: "PUT",
    body: JSON.stringify({ tasks: normalizedTasks }),
  });
  if (!Array.isArray(body?.tasks)) throw new Error("The cloud returned an invalid task list.");
  return body.tasks;
}
