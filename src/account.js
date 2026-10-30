import { authConfigured, getCurrentUser, signIn, signInWithGoogle, signOut, signUp } from "./auth.js";

const closeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const googleIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.82h5.38a4.6 4.6 0 0 1-2 3.02v2.48h3.23c1.9-1.74 2.99-4.31 2.99-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.47l-3.24-2.48c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.07v2.56A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.89A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.89V7.55H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.45l3.33-2.56Z"/><path fill="#EA4335" d="M12 5.99c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.55l3.33 2.56C7.19 7.75 9.4 5.99 12 5.99Z"/></svg>';

export function createAccountController({ root, button, onAuthenticated, onSignedOut, onError }) {
  const panel = document.createElement("section");
  panel.className = "account-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Hobo cloud account");
  root.append(panel);

  let mode = "sign-in";
  let user = null;
  let busy = false;
  let syncState = "local";

  function setButton() {
    const label = button.querySelector(".storage-label");
    button.hidden = !authConfigured;
    button.dataset.state = syncState;
    if (!authConfigured) return;
    if (syncState === "syncing") label.textContent = "Syncing…";
    else if (syncState === "error") label.textContent = "Cloud sync needs attention";
    else if (user) label.textContent = "Cloud sync on";
    else label.textContent = "Sign in to sync";
    button.setAttribute("aria-label", user ? `Hobo account for ${user.email}` : "Sign in to sync Hobo");
  }

  function render() {
    setButton();
    if (panel.hidden) return;
    if (user) {
      const initial = (user.name || user.email || "H").trim().charAt(0).toUpperCase();
      panel.innerHTML = `
        <div class="account-header">
          <div><span class="eyebrow">HOBO CLOUD</span><h2>Your account</h2></div>
          <button class="icon-button account-close" type="button" aria-label="Close account panel">${closeIcon}</button>
        </div>
        <div class="account-profile">
          <span class="account-avatar"></span>
          <div><strong class="account-name"></strong><span class="account-email"></span></div>
        </div>
        <div class="account-sync-status" data-state="${syncState}">
          <i></i><span>${syncState === "syncing" ? "Syncing your tasks…" : syncState === "error" ? "Tasks are safe locally. Cloud sync needs attention." : "Your tasks are synced to Neon."}</span>
        </div>
        <button class="account-secondary retry-sync" type="button">Sync now</button>
        <button class="account-signout" type="button">Sign out</button>
        <p class="account-note">Signing out keeps this device’s current tasks.</p>
      `;
      panel.querySelector(".account-avatar").textContent = initial;
      panel.querySelector(".account-name").textContent = user.name || "Hobo user";
      panel.querySelector(".account-email").textContent = user.email;
      panel.querySelector(".account-close").addEventListener("click", close);
      panel.querySelector(".account-signout").addEventListener("click", handleSignOut);
      panel.querySelector(".retry-sync").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        await onAuthenticated(user, { forceDownload: false });
        event.currentTarget.disabled = false;
      });
      return;
    }

    const creating = mode === "sign-up";
    panel.innerHTML = `
      <div class="account-header">
        <div><span class="eyebrow">HOBO CLOUD</span><h2>${creating ? "Create your account" : "Welcome back"}</h2></div>
        <button class="icon-button account-close" type="button" aria-label="Close account panel">${closeIcon}</button>
      </div>
      <p class="account-intro">${creating ? "Keep your to-dos in sync, wherever Hobo goes." : "Sign in to sync your tasks securely with Neon."}</p>
      <button class="google-signin" type="button">${googleIcon}<span>Continue with Google</span></button>
      <div class="account-divider"><span>or use email</span></div>
      <div class="account-tabs" role="tablist" aria-label="Account action">
        <button type="button" role="tab" data-mode="sign-in" aria-selected="${!creating}">Sign in</button>
        <button type="button" role="tab" data-mode="sign-up" aria-selected="${creating}">Create account</button>
      </div>
      <form class="account-form">
        ${creating ? '<label>Name<input name="name" type="text" maxlength="80" autocomplete="name" placeholder="Your name" required /></label>' : ""}
        <label>Email<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required /></label>
        <label>Password<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${creating ? "new-password" : "current-password"}" placeholder="At least 8 characters" required /></label>
        <p class="account-error" role="alert" hidden></p>
        <button class="account-submit" type="submit">${creating ? "Create account" : "Sign in"}</button>
      </form>
      <p class="account-note">Your existing tasks stay on this device and move to your cloud account on first sync.</p>
    `;
    panel.querySelector(".account-close").addEventListener("click", close);
    panel.querySelector(".google-signin").addEventListener("click", handleGoogleSignIn);
    panel.querySelectorAll("[data-mode]").forEach((tab) => {
      tab.addEventListener("click", () => {
        mode = tab.dataset.mode;
        render();
      });
    });
    panel.querySelector(".account-form").addEventListener("submit", handleSubmit);
  }

  function open() {
    panel.hidden = false;
    render();
    requestAnimationFrame(() => panel.querySelector("input, .account-close")?.focus());
  }

  function close() {
    panel.hidden = true;
    button.focus();
  }

  async function handleGoogleSignIn(event) {
    if (busy) return;
    const googleButton = event.currentTarget;
    const errorElement = panel.querySelector(".account-error");
    busy = true;
    googleButton.disabled = true;
    googleButton.querySelector("span").textContent = "Opening Google…";
    errorElement.hidden = true;
    syncState = "syncing";
    setButton();

    try {
      await signInWithGoogle();
      user = await getCurrentUser();
      if (!user) throw new Error("Google sign-in was not completed. Please try again.");
      await onAuthenticated(user, { forceDownload: false });
      syncState = "synced";
      render();
      close();
    } catch (error) {
      syncState = "local";
      setButton();
      errorElement.textContent = error.message || "Could not sign in with Google. Please try again.";
      errorElement.hidden = false;
      googleButton.disabled = false;
      googleButton.querySelector("span").textContent = "Continue with Google";
      onError?.(error);
    } finally {
      busy = false;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const errorElement = form.querySelector(".account-error");
    const submit = form.querySelector(".account-submit");
    busy = true;
    submit.disabled = true;
    submit.textContent = mode === "sign-up" ? "Creating…" : "Signing in…";
    errorElement.hidden = true;
    syncState = "syncing";
    setButton();

    try {
      user = mode === "sign-up"
        ? await signUp({ email: values.get("email").trim(), password: values.get("password"), name: values.get("name").trim() })
        : await signIn({ email: values.get("email").trim(), password: values.get("password") });
      await onAuthenticated(user, { forceDownload: false });
      syncState = "synced";
      render();
      close();
    } catch (error) {
      syncState = user ? "error" : "local";
      if (user) {
        render();
      } else {
        setButton();
        errorElement.textContent = error.message || "Something went wrong. Please try again.";
        errorElement.hidden = false;
        submit.disabled = false;
        submit.textContent = mode === "sign-up" ? "Create account" : "Sign in";
      }
      onError?.(error);
    } finally {
      busy = false;
    }
  }

  async function handleSignOut() {
    if (busy) return;
    busy = true;
    const signoutButton = panel.querySelector(".account-signout");
    signoutButton.disabled = true;
    signoutButton.textContent = "Signing out…";
    try {
      await signOut();
      user = null;
      syncState = "local";
      onSignedOut();
      render();
    } catch (error) {
      onError?.(error);
      signoutButton.disabled = false;
      signoutButton.textContent = "Sign out";
    } finally {
      busy = false;
    }
  }

  button.addEventListener("click", () => panel.hidden ? open() : close());

  return {
    async initialize() {
      if (!authConfigured) {
        setButton();
        return;
      }
      syncState = "syncing";
      setButton();
      try {
        user = await getCurrentUser();
        if (user) {
          await onAuthenticated(user, { forceDownload: false });
          syncState = "synced";
        } else {
          syncState = "local";
        }
      } catch (error) {
        syncState = user ? "error" : "local";
        onError?.(error);
      }
      setButton();
    },
    setSyncState(state) {
      syncState = state;
      setButton();
      if (!busy && !panel.hidden && user) render();
    },
  };
}
