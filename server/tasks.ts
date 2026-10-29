import { attachDatabasePool } from "@neon/functions";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";

const MAX_TASKS = 500;
const VALID_TAGS = new Set(["", "urgent", "work", "personal"]);
const LOCAL_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:7100",
  "http://127.0.0.1:7100",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);
const configuredOrigins = (process.env.APP_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...LOCAL_ORIGINS, ...configuredOrigins]);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
attachDatabasePool(pool);

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let issuer: string | undefined;

type AppVariables = { userId: string };
type AppContext = Context<{ Variables: AppVariables }>;
type TaskInput = {
  id: string;
  text: string;
  completed: boolean;
  tag: string;
  timerEndsAt: number | null;
  createdAt: number;
};

const app = new Hono<{ Variables: AppVariables }>();

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  const middleware = cors({
    origin: (requestOrigin) => allowedOrigins.has(requestOrigin) ? requestOrigin : "",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "PUT", "OPTIONS"],
    maxAge: 600,
  });
  if (origin && !allowedOrigins.has(origin) && c.req.method === "OPTIONS") {
    return c.json({ error: "Origin not allowed" }, 403);
  }
  return middleware(c, next);
});

app.get("/health", async (c) => {
  await pool.query("SELECT 1");
  return c.json({ ok: true, service: "hobo-tasks" });
});

async function authenticate(c: AppContext, next: Next) {
  if (!process.env.NEON_AUTH_JWKS_URL || !process.env.NEON_AUTH_BASE_URL) {
    return c.json({ error: "Authentication is not configured" }, 503);
  }

  const authorization = c.req.header("Authorization") || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return c.json({ error: "Sign in required" }, 401);
  }

  try {
    jwks ??= createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL));
    issuer ??= new URL(process.env.NEON_AUTH_BASE_URL).origin;
    const { payload } = await jwtVerify(token, jwks, { issuer });
    if (!payload.sub) {
      return c.json({ error: "Invalid session" }, 401);
    }
    c.set("userId", payload.sub);
    await next();
  } catch {
    return c.json({ error: "Session expired or invalid" }, 401);
  }
}

app.use("/tasks", authenticate);
app.use("/tasks/*", authenticate);

function mapTask(row: Record<string, unknown>) {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed,
    tag: row.tag,
    timerEndsAt: row.timer_ends_at === null ? null : Number(row.timer_ends_at),
    createdAt: Number(row.created_at),
  };
}

app.get("/tasks", async (c) => {
  const result = await pool.query(
    `SELECT id, text, completed, tag, timer_ends_at, created_at
     FROM tasks WHERE user_id = $1 ORDER BY position ASC`,
    [c.get("userId")],
  );
  return c.json({ tasks: result.rows.map(mapTask) });
});

function parseTasks(value: unknown): TaskInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_TASKS) return null;
  const ids = new Set<string>();
  const tasks: TaskInput[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const task = candidate as Record<string, unknown>;
    if (
      typeof task.id !== "string" || task.id.length < 1 || task.id.length > 100 ||
      typeof task.text !== "string" || task.text.trim().length < 1 || task.text.length > 240 ||
      typeof task.completed !== "boolean" ||
      typeof task.tag !== "string" || !VALID_TAGS.has(task.tag) ||
      typeof task.createdAt !== "number" || !Number.isSafeInteger(task.createdAt) || task.createdAt < 0 ||
      !(task.timerEndsAt === null || (typeof task.timerEndsAt === "number" && Number.isSafeInteger(task.timerEndsAt) && task.timerEndsAt >= 0)) ||
      ids.has(task.id)
    ) return null;

    ids.add(task.id);
    tasks.push({
      id: task.id,
      text: task.text.trim(),
      completed: task.completed,
      tag: task.tag,
      timerEndsAt: task.timerEndsAt as number | null,
      createdAt: task.createdAt,
    });
  }
  return tasks;
}

app.put("/tasks/sync", async (c) => {
  let body: { tasks?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const tasks = parseTasks(body.tasks);
  if (!tasks) {
    return c.json({ error: `Expected up to ${MAX_TASKS} valid tasks with unique IDs` }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM tasks WHERE user_id = $1", [c.get("userId")]);
    for (const [position, task] of tasks.entries()) {
      await client.query(
        `INSERT INTO tasks
          (user_id, id, text, completed, tag, timer_ends_at, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          c.get("userId"), task.id, task.text, task.completed, task.tag,
          task.timerEndsAt, position, task.createdAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return c.json({ tasks });
});

app.onError((error, c) => {
  console.error("Hobo task API error", error);
  return c.json({ error: "The task service is temporarily unavailable" }, 500);
});

export default app;
