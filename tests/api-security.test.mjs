import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "postgres://unused:unused@127.0.0.1:9/unused";
process.env.NEON_AUTH_BASE_URL = "https://auth.example.test/api/auth";
process.env.NEON_AUTH_JWKS_URL = "https://auth.example.test/.well-known/jwks.json";

const { default: app } = await import("../server/tasks.ts");

test("task reads reject requests without a bearer token", async () => {
  const response = await app.request("/tasks");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Sign in required" });
});

test("task sync rejects requests without a bearer token", async () => {
  const response = await app.request("/tasks/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: [] }),
  });
  assert.equal(response.status, 401);
});

test("malformed bearer tokens are rejected", async () => {
  const response = await app.request("/tasks", {
    headers: { Authorization: "Bearer not-a-jwt" },
  });
  assert.equal(response.status, 401);
});

test("allowed local origins receive CORS headers", async () => {
  const response = await app.request("/tasks", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:1420",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:1420");
});

test("unknown browser origins cannot preflight the API", async () => {
  const response = await app.request("/tasks", {
    method: "OPTIONS",
    headers: {
      Origin: "https://malicious.example",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(response.status, 403);
});
