/**
 * Utilitaires conformes à Modern Web Guidance :
 * - Modales natives <dialog> avec closedby="any" + fallback pointeur hors boîte
 * - Animation d'entrée/sortie top-layer (@starting-style + fallback data-closing)
 * - Synchronisation ARIA :user-invalid + annonceur live poli
 * - Notifications Toast compatibles top-layer
 */

let supportsDisplayTransition;

export function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

export function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay());
}

export async function closeDialogSmoothly(dialog) {
  if (!dialog || !dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 350))
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  dialog.close();
}

export function setupDialogBehavior(dialog) {
  if (!dialog || dialog._mwgInitialized) return;
  dialog._mwgInitialized = true;

  // Reset returnValue on close to prevent stale values leaking across Esc/dismiss
  dialog.addEventListener("close", () => {
    dialog.returnValue = "";
    dialog.removeAttribute("data-closing");
  });

  // Route Esc cancel through smooth top-layer exit helper
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialogSmoothly(dialog);
  });

  // Fallback for browsers without native <dialog closedby="any">
  if (!("closedBy" in HTMLDialogElement.prototype) && dialog.getAttribute("closedby") === "any") {
    const outside = (e, d) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dialog.addEventListener("pointerdown", (e) => {
      if (e.target === dialog) {
        pressedOutside = outside(e, dialog);
      } else {
        pressedOutside = false;
      }
    });
    dialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && e.target === dialog && outside(e, dialog)) {
        closeDialogSmoothly(dialog);
      }
      pressedOutside = false;
    });
  }
}

export function initAllDialogs() {
  document.querySelectorAll("dialog").forEach((d) => setupDialogBehavior(d));
}

/**
 * Synchronisation ARIA pour :user-invalid (Modern Web Guidance: validate-input-after-interaction)
 */
export function initFormValidationAria() {
  const linkError = (el, shown) => {
    const errorId = el.dataset?.error;
    if (!errorId) return;
    const ids = (el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  };

  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.className = "visually-hidden";
  document.body.append(announcer);

  let announceTimer;
  let announcedField;

  const spokenText = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
      n.replaceWith(`${n.getAttribute("aria-label")}: `);
    });
    return copy.textContent.replace(/\s+/g, " ").trim();
  };

  const announceError = (el) => {
    const error = document.getElementById(el.dataset?.error);
    if (!error) return;
    const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(error);
    }, 500);
  };

  const supportsUserInvalid = window.CSS?.supports?.("selector(:user-invalid)");
  const dirtyState = new WeakMap();
  const flagged = new WeakSet();
  const announced = new WeakSet();

  const syncAria = (el, announce = false) => {
    if (!el?.matches?.("input, select, textarea")) return;
    let invalid = false;
    if (supportsUserInvalid) {
      invalid = el.matches(":user-invalid");
    } else {
      const st = dirtyState.get(el);
      invalid = Boolean(st?.hasInteracted && st?.hasBlurred && !el.validity.valid);
      el.classList.toggle("user-invalid-fallback", invalid);
      el.classList.toggle("user-valid-fallback", Boolean(st?.hasInteracted && st?.hasBlurred && el.validity.valid));
    }

    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute("aria-invalid", "true");
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
      el.setAttribute("aria-invalid", "false");
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = "";
      }
    }
  };

  document.querySelectorAll("input, select, textarea").forEach((el) => syncAria(el));

  document.addEventListener(
    "blur",
    (e) => {
      if (e.target?.matches?.("input, select, textarea")) {
        const st = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
        st.hasBlurred = true;
        dirtyState.set(e.target, st);
        syncAria(e.target, true);
      }
    },
    true
  );

  document.addEventListener("input", (e) => {
    if (e.target?.matches?.("input, select, textarea")) {
      const st = dirtyState.get(e.target) || { hasInteracted: false, hasBlurred: false };
      st.hasInteracted = true;
      dirtyState.set(e.target, st);
      if (e.target.hasAttribute("aria-invalid")) syncAria(e.target);
    }
  });

  document.addEventListener("change", (e) => syncAria(e.target, true), true);

  document.addEventListener(
    "invalid",
    (e) => {
      if (e.target?.matches?.("input, select, textarea")) {
        dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
        announced.add(e.target);
        syncAria(e.target);
      }
    },
    true
  );

  document.addEventListener(
    "reset",
    (e) => {
      setTimeout(() => {
        [...(e.target.elements || [])].forEach((el) => {
          dirtyState.delete(el);
          el.classList.remove("user-invalid-fallback", "user-valid-fallback");
          syncAria(el);
        });
      });
    },
    true
  );
}

/**
 * Toast Notifications (se place automatiquement dans le <dialog> actif s'il est dans le top-layer)
 */
export function showToast(message, type = "success", duration = 3600) {
  if (typeof document === "undefined") return;
  let container = document.getElementById("toast-container");

  const openDialogs = Array.from(document.querySelectorAll("dialog[open]"));
  const topDialog = openDialogs[openDialogs.length - 1];
  if (topDialog) {
    let dialogContainer = topDialog.querySelector(".dialog-toast-container");
    if (!dialogContainer) {
      dialogContainer = document.createElement("div");
      dialogContainer.className = "toast-container dialog-toast-container";
      topDialog.appendChild(dialogContainer);
    }
    container = dialogContainer;
  }
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");

  const iconSvg =
    type === "success"
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon"><path d="M20 6 9 17l-5-5"/></svg>`
      : type === "error"
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;

  toast.innerHTML = `
    <div class="toast-content">
      ${iconSvg}
      <span class="toast-message"></span>
    </div>
    <button type="button" class="toast-close" aria-label="Fermer la notification">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  `;
  toast.querySelector(".toast-message").textContent = message;

  const timer = setTimeout(() => dismiss(), duration);
  function dismiss() {
    clearTimeout(timer);
    toast.classList.remove("toast-visible");
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), 260);
  }

  toast.querySelector(".toast-close").addEventListener("click", dismiss);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
}

export function playChime(kind = "success") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const now = ctx.currentTime;
    if (kind === "delivery") {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      osc.frequency.setValueAtTime(783.99, now + 0.2);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.16);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    }
  } catch {
    // ignore autoplay restriction
  }
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
