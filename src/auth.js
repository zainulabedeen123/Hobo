import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla/adapters";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
export const authConfigured = Boolean(authUrl && import.meta.env.VITE_TASK_API_URL);
export const authClient = authConfigured ? createAuthClient(authUrl, {
  adapter: BetterAuthVanillaAdapter({
    fetchOptions: { credentials: "include" },
  }),
}) : null;

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

export async function signInWithGoogle() {
  const callbackURL = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL,
  });
  authError(result, "Could not sign in with Google.");
}

export async function signOut() {
  const result = await authClient.signOut();
  authError(result, "Could not sign out.");
}

export async function getAccessToken() {
  // Managed Auth can return the JWT directly or attached to the cached session.
  let result = await authClient.token();
  let data = authError(result, "Could not authorize cloud sync.");
  let token = data?.token || data?.session?.token;
  if (!token && typeof authClient.getToken === "function") {
    result = await authClient.getToken();
    data = authError(result, "Could not authorize cloud sync.");
    token = data?.token;
  }
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  return token;
}
