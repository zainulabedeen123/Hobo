import { authConfigured, getCurrentUser, signIn, signOut, signUp } from "./auth.js";

const closeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';

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
      setButton();
      errorElement.textContent = error.message || "Something went wrong. Please try again.";
      errorElement.hidden = false;
      submit.disabled = false;
      submit.textContent = mode === "sign-up" ? "Create account" : "Sign in";
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
      if (!panel.hidden && user) render();
    },
  };
}
