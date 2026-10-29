import { createAuthClient } from "@neondatabase/auth";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
export const authConfigured = Boolean(authUrl && import.meta.env.VITE_TASK_API_URL);
export const authClient = authConfigured ? createAuthClient(authUrl) : null;

function authError(result, fallback) {
  if (result?.error) {
    throw new Error(result.error.message || fallback);
  }
  return result?.data;
}

export async function getCurrentUser() {
  if (!authClient) return null;
  const result = await authClient.getSession();
  return authError(result, "Could not restore your session.")?.user || null;
}

export async function signUp({ email, password, name }) {
  const result = await authClient.signUp.email({ email, password, name });
  const data = authError(result, "Could not create your account.");
  if (!data?.user) throw new Error("No account was returned. Please try again.");
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Your account was created. Verify your email if asked, then sign in.");
  }
  return currentUser;
}

export async function signIn({ email, password }) {
  const result = await authClient.signIn.email({ email, password });
  const data = authError(result, "Could not sign in.");
  if (!data?.user) throw new Error("No active session was returned. Please try again.");
  return data.user;
}

export async function signOut() {
  const result = await authClient.signOut();
  authError(result, "Could not sign out.");
}

export async function getAccessToken() {
  const result = await authClient.token();
  const data = authError(result, "Could not authorize cloud sync.");
  if (!data?.token) throw new Error("Your session has expired. Please sign in again.");
  return data.token;
}
