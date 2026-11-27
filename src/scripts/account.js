/**
 * Menu Compte Client & Modale d'Authentification Sécurisée (#account-dialog) :
 * - Popup menu header conforme Modern Web Guidance (`menu`: commandfor/toggle-popover, focusgroup="menu nomemory",
 *   CSS Anchor Positioning + fallbacks JS complets pour anciens navigateurs)
 * - Formulaires d'inscription & connexion conformes Modern Web Guidance (`autofill-sign-up-form`,
 *   `autofill-sign-in-form`, `forms`: autocomplete="username"/"new-password"/"current-password",
 *   champ nom unique Unicode, sans double saisie de mot de passe, collage autorisé, toggle aria-pressed)
 * - Sessions HttpOnly + CSRF + synchronisation multi-onglets + verrou anti-double-soumission
 */

import { closeDialogSmoothly, showToast, escapeHtml } from "./mwg-helpers.js";
import { siteTracker } from "./site-tracker.js";
import { openLiveOrderDialog } from "./order-dialog.js";
import { openCustomerDiscussion } from "./discussion-widget.js";

const SYNC_CHANNEL_NAME = "nexus_account_sync_v1";

function evaluateClientPasswordStrength(password, email = "", name = "") {
  const raw = String(password || "");
  const checks = [
    { id: "len", ok: raw.length >= 10, label: "10 caractères min." },
    { id: "upper", ok: /[A-Z]/.test(raw), label: "1 majuscule" },
    { id: "lower", ok: /[a-z]/.test(raw), label: "1 minuscule" },
    { id: "digit", ok: /\d/.test(raw), label: "1 chiffre" },
    { id: "sym", ok: /[^A-Za-z0-9]/.test(raw), label: "1 symbole (!@#...)" }
  ];
  const classes = checks.slice(1).filter((c) => c.ok).length;
  const emailLocal = String(email || "").trim().toLowerCase().split("@")[0] || "";
  const lower = raw.toLowerCase();
  const containsEmail = emailLocal.length >= 4 && lower.includes(emailLocal);
  const containsName = String(name || "").trim().length >= 4 && lower.includes(String(name).trim().toLowerCase());

  let score = 0;
  if (raw.length >= 10) score += 25;
  if (raw.length >= 14) score += 20;
  if (raw.length >= 18) score += 10;
  score += classes * 11;
  if (containsEmail || containsName) score = Math.min(score, 35);
  score = Math.max(0, Math.min(100, score));

  const valid =
    raw.length >= 10 &&
    raw.length <= 128 &&
    ((raw.length >= 14 && classes >= 2) || classes >= 3) &&
    !containsEmail &&
    !containsName;

  const level = !raw ? "empty" : score >= 80 && valid ? "strong" : score >= 55 && valid ? "medium" : "weak";
  const levelLabel =
    level === "strong" ? "Fort" : level === "medium" ? "Correct" : level === "weak" ? "Trop faible" : "";

  return { score, valid, level, levelLabel, checks, containsEmail, containsName };
}

function getInitials(name = "") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "👤";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getFirstName(name = "") {
  return String(name || "").trim().split(/\s+/)[0] || "Mon compte";
}

class AccountController {
  constructor() {
    this.authenticated = false;
    this.user = null;
    this.csrfToken = "";
    this.sessions = [];
    this.orders = [];
    this.discussions = [];
    this.listeners = new Set();
    this.activeView = "login"; // 'login' | 'register' | 'forgot' | 'overview' | 'discussions' | 'security'
    this.inFlight = false;
    this.formOpenedAtMs = 0;
    this.syncChannel = null;
    this.menuInitialized = false;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.renderHeaderMenu();
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error("[Account listener error]", err);
      }
    }
  }

  broadcastSync(kind) {
    try {
      this.syncChannel?.postMessage({ kind, ts: Date.now() });
    } catch {
      // ignore
    }
  }

  async init() {
    // Synchronisation multi-onglets propre pour éviter tout état désynchronisé
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
        this.syncChannel.onmessage = (ev) => {
          if (ev.data?.kind === "logout") {
            this.clearClientStateOnly();
            const dialog = document.getElementById("account-dialog");
            if (dialog?.open) this.renderDialog();
          } else if (ev.data?.kind === "login" || ev.data?.kind === "refresh") {
            this.fetchSession({ silent: true });
          }
        };
      } catch {
        // ignore
      }
    }

    this.setupAccountPopoverMenu();
    await this.fetchSession({ silent: true });
    this.renderHeaderMenu();

    window.openAccountModal = (view = null) => this.openModal(view);
  }

  clearClientStateOnly() {
    this.authenticated = false;
    this.user = null;
    this.csrfToken = "";
    this.sessions = [];
    this.orders = [];
    this.discussions = [];
    this.emit();
  }

  async fetchSession({ silent = true } = {}) {
    try {
      const resp = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!resp.ok) {
        this.clearClientStateOnly();
        return false;
      }
      const data = await resp.json();
      if (data.authenticated && data.user) {
        this.authenticated = true;
        this.user = data.user;
        this.csrfToken = data.csrfToken || "";
        this.sessions = Array.isArray(data.sessions) ? data.sessions : [];
        this.orders = Array.isArray(data.orders) ? data.orders : [];
        this.discussions = Array.isArray(data.discussions) ? data.discussions : [];
        this.emit();
        return true;
      }
      this.clearClientStateOnly();
      return false;
    } catch {
      if (!silent) showToast("Impossible de vérifier votre session (mode hors-ligne).", "error");
      return false;
    }
  }

  /**
   * Initialise le popup menu Compte du header conformément à Modern Web Guidance (`menu`)
   */
  setupAccountPopoverMenu() {
    if (this.menuInitialized) return;
    const trigger = document.getElementById("account-menu-trigger");
    const popover = document.getElementById("account-menu-popover");
    const group = document.getElementById("account-menu-items");
    if (!trigger || !popover || !group) return;
    this.menuInitialized = true;

    const supportsPopover = Object.hasOwn(HTMLElement.prototype, "popover");
    const supportsCommands = "commandForElement" in HTMLButtonElement.prototype;
    const supportsAnchor = Boolean(window.CSS?.supports?.("position-area", "block-end"));
    const supportsFocusGroup = "focusGroup" in HTMLElement.prototype;

    const enterOnOpen = new WeakSet();
    let pointerPressedTrigger = false;

    const isOpen = () =>
      supportsPopover ? popover.matches(":popover-open") : popover.classList.contains(":popover-open");

    const getMenuItems = () =>
      Array.from(group.querySelectorAll("button")).filter(
        (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true"
      );

    const positionFallback = () => {
      if (supportsAnchor) return;
      const rect = trigger.getBoundingClientRect();
      popover.style.position = "fixed";
      popover.style.margin = "0";
      popover.style.inset = "auto";
      const popWidth = Math.max(240, popover.offsetWidth || 250);
      const left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, rect.right - popWidth));
      const top = Math.min(window.innerHeight - 240, rect.bottom + 8);
      popover.style.left = `${left}px`;
      popover.style.top = `${Math.max(12, top)}px`;
    };

    const showManualPopover = () => {
      if (supportsPopover) {
        try {
          popover.showPopover({ source: trigger });
        } catch {
          popover.showPopover();
        }
      } else {
        popover.classList.add(":popover-open");
        trigger.setAttribute("aria-expanded", "true");
        positionFallback();
        if (enterOnOpen.has(popover)) {
          enterOnOpen.delete(popover);
          getMenuItems()[0]?.focus({ preventScroll: true });
        }
      }
    };

    const hideManualPopover = ({ restoreFocus = false } = {}) => {
      if (supportsPopover) {
        if (isOpen()) popover.hidePopover();
      } else {
        popover.classList.remove(":popover-open");
        trigger.setAttribute("aria-expanded", "false");
      }
      if (restoreFocus) trigger.focus({ preventScroll: true });
    };

    this._hideAccountPopover = hideManualPopover;

    // Fallback invoker commands pour navigateurs sans commandfor="...":
    // Utilise popovertarget natif si Popover API présente (évite le conflit light-dismiss), sinon toggle manuel
    if (!supportsCommands) {
      if (supportsPopover) {
        trigger.setAttribute("popovertarget", popover.id);
      } else {
        trigger.addEventListener("click", () => {
          if (isOpen()) hideManualPopover();
          else {
            if (!pointerPressedTrigger) enterOnOpen.add(popover);
            showManualPopover();
          }
          pointerPressedTrigger = false;
        });
      }
    }

    trigger.addEventListener("pointerdown", () => {
      pointerPressedTrigger = true;
    });

    // Clavier sur le trigger : ArrowDown ouvre et entre, Enter/Space natif via commandfor
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!isOpen()) {
          enterOnOpen.add(popover);
          if (supportsCommands) trigger.click();
          else showManualPopover();
        } else {
          getMenuItems()[0]?.focus({ preventScroll: true });
        }
      } else if (e.key === "Enter" || e.key === " ") {
        if (!isOpen()) enterOnOpen.add(popover);
      }
    });

    if (supportsPopover) {
      popover.addEventListener("toggle", (e) => {
        const opened = e.newState === "open";
        trigger.setAttribute("aria-expanded", opened ? "true" : "false");
        if (opened) {
          positionFallback();
          if (enterOnOpen.has(popover) && !pointerPressedTrigger) {
            enterOnOpen.delete(popover);
            requestAnimationFrame(() => getMenuItems()[0]?.focus({ preventScroll: true }));
          }
          pointerPressedTrigger = false;
        } else {
          enterOnOpen.delete(popover);
        }
      });
    } else {
      // Light-dismiss manuel si Popover API absente
      document.addEventListener("pointerdown", (e) => {
        if (isOpen() && !popover.contains(e.target) && !trigger.contains(e.target)) {
          hideManualPopover();
        }
      });
    }

    // Fallback focusgroup si non supporté nativement (ne jamais ajouter de role="menu" si focusGroup natif existe)
    if (!supportsFocusGroup) {
      group.setAttribute("role", "menu");
      group.addEventListener(
        "keydown",
        (event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          const items = getMenuItems();
          const current = items.indexOf(document.activeElement);
          if (current < 0) return;
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
              ? items.length - 1
              : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
          event.preventDefault();
          event.stopImmediatePropagation();
          items[next]?.focus({ preventScroll: true });
        },
        true
      );
    }

    // Navigation Escape / Tab dans le menu + hover-follows-focus
    popover.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideManualPopover({ restoreFocus: true });
      } else if (e.key === "Tab") {
        hideManualPopover({ restoreFocus: false });
      }
    });

    popover.addEventListener("pointermove", (e) => {
      const btn = e.target.closest("button");
      if (btn && group.contains(btn) && document.activeElement !== btn) {
        if (document.elementFromPoint(e.clientX, e.clientY)?.closest("button") === btn) {
          btn.focus({ preventScroll: true });
        }
      }
    });

    // Fermer si le focus sort totalement du menu
    document.addEventListener("focusin", (e) => {
      if (isOpen() && !popover.contains(e.target) && e.target !== trigger) {
        hideManualPopover({ restoreFocus: false });
      }
    });

    // Délégation d'actions sur les commandes du menu
    group.addEventListener("click", (e) => {
      const item = e.target.closest("[data-account-menu-action]");
      if (!item) return;
      const action = item.getAttribute("data-account-menu-action");
      hideManualPopover({ restoreFocus: false });

      if (action === "login") this.openModal("login");
      else if (action === "register") this.openModal("register");
      else if (action === "overview") this.openModal("overview");
      else if (action === "discussions") this.openModal("discussions");
      else if (action === "security") this.openModal("security");
      else if (action === "guest-orders") window.openOrderTracker?.();
      else if (action === "logout") this.logout();
    });
  }

  renderHeaderMenu() {
    const trigger = document.getElementById("account-menu-trigger");
    const group = document.getElementById("account-menu-items");
    const mobileBtn = document.getElementById("mobile-account-btn");
    const supportsFocusGroup = "focusGroup" in HTMLElement.prototype;
    const roleAttr = supportsFocusGroup ? "" : ' role="menuitem"';

    if (trigger) {
      if (this.authenticated && this.user) {
        trigger.classList.add("account-trigger-logged");
        trigger.innerHTML = `
          <span class="account-avatar-chip" aria-hidden="true">${escapeHtml(getInitials(this.user.name))}</span>
          <span class="account-btn-label">${escapeHtml(getFirstName(this.user.name))}</span>
          <span class="account-chevron" aria-hidden="true">▾</span>
        `;
      } else {
        trigger.classList.remove("account-trigger-logged");
        trigger.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span class="account-btn-label">Compte</span>
          <span class="account-chevron" aria-hidden="true">▾</span>
        `;
      }
    }

    if (group) {
      if (this.authenticated && this.user) {
        group.innerHTML = `
          <div class="account-menu-user-banner">
            <div class="account-menu-avatar-lg" aria-hidden="true">${escapeHtml(getInitials(this.user.name))}</div>
            <div class="account-menu-user-text">
              <strong>${escapeHtml(this.user.name)}</strong>
              <span>${escapeHtml(this.user.email)}</span>
            </div>
          </div>
          <hr />
          <button type="button"${roleAttr} data-account-menu-action="overview">
            <span class="menu-item-ico" aria-hidden="true">📦</span>
            <span>Mon espace &amp; Commandes</span>
            <span class="hint">${this.orders.length}</span>
          </button>
          <button type="button"${roleAttr} data-account-menu-action="discussions">
            <span class="menu-item-ico" aria-hidden="true">💬</span>
            <span>Mes discussions en direct</span>
            <span class="hint">${this.discussions.length}</span>
          </button>
          <button type="button"${roleAttr} data-account-menu-action="security">
            <span class="menu-item-ico" aria-hidden="true">🛡️</span>
            <span>Sécurité &amp; Sessions</span>
            <span class="hint">${this.sessions.length}</span>
          </button>
          <hr />
          <button type="button"${roleAttr} class="menu-item-danger" data-account-menu-action="logout">
            <span class="menu-item-ico" aria-hidden="true">🚪</span>
            <span>Se déconnecter</span>
          </button>
        `;
      } else {
        group.innerHTML = `
          <button type="button"${roleAttr} data-account-menu-action="login">
            <span class="menu-item-ico" aria-hidden="true">🔑</span>
            <span>Se connecter</span>
          </button>
          <button type="button"${roleAttr} data-account-menu-action="register">
            <span class="menu-item-ico" aria-hidden="true">✨</span>
            <span>Créer un compte sécurisé</span>
          </button>
          <hr />
          <button type="button"${roleAttr} data-account-menu-action="guest-orders">
            <span class="menu-item-ico" aria-hidden="true">📦</span>
            <span>Suivre une commande invité</span>
          </button>
        `;
      }
    }

    if (mobileBtn) {
      mobileBtn.innerHTML =
        this.authenticated && this.user
          ? `👤 Mon compte (${escapeHtml(getFirstName(this.user.name))})`
          : "🔑 Se connecter / Créer un compte";
    }
  }

  async openModal(view = null) {
    const dialog = document.getElementById("account-dialog");
    if (!dialog) return;

    this._hideAccountPopover?.({ restoreFocus: false });
    await this.fetchSession({ silent: true });

    if (this.authenticated) {
      this.activeView = ["overview", "discussions", "security"].includes(view) ? view : "overview";
    } else {
      this.activeView = ["login", "register", "forgot"].includes(view) ? view : "login";
      this.formOpenedAtMs = Date.now();
    }

    siteTracker.track("auth_open", this.activeView);
    this.renderDialog();
    if (!dialog.open) dialog.showModal();
  }

  async logout() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: this.csrfToken ? { "X-CSRF-Token": this.csrfToken } : {},
        credentials: "same-origin"
      });
    } catch {
      // ignore offline
    } finally {
      this.inFlight = false;
    }

    // Nettoyage complet des jetons de commandes/discussions privées sur cet appareil (anti-fuite multi-comptes)
    try {
      localStorage.removeItem("nexus_my_orders_v2");
      localStorage.removeItem("nexus_customer_discussion_v1");
    } catch {
      // ignore
    }

    this.clearClientStateOnly();
    this.broadcastSync("logout");
    const dialog = document.getElementById("account-dialog");
    if (dialog?.open) await closeDialogSmoothly(dialog);
    showToast("Déconnexion sécurisée effectuée. Vos données locales ont été nettoyées.", "info", 4200);
  }

  renderDialog() {
    const dialog = document.getElementById("account-dialog");
    const container = document.getElementById("account-dialog-content");
    if (!dialog || !container) return;

    if (!this.authenticated) {
      container.innerHTML = this.renderAuthViews();
      this.bindAuthEvents(dialog, container);
      return;
    }

    container.innerHTML = this.renderAccountDashboard();
    this.bindDashboardEvents(dialog, container);
  }

  renderAuthViews() {
    const isLogin = this.activeView === "login";
    const isRegister = this.activeView === "register";
    const isForgot = this.activeView === "forgot";

    return `
      <div class="checkout-header">
        <div class="checkout-header-title">
          <div class="checkout-lock-badge" aria-hidden="true">${isRegister ? "✨" : isForgot ? "🛡️" : "🔐"}</div>
          <div>
            <h1 id="account-dialog-title" class="checkout-title">
              ${isRegister ? "Créer votre compte NEXUS" : isForgot ? "Récupérer l'accès à votre compte" : "Connexion à votre espace client"}
            </h1>
            <p class="checkout-subtitle">Session chiffrée HttpOnly • Retrouvez tous vos accès et discussions en 1 clic</p>
          </div>
        </div>
        <button type="button" class="btn-close-dialog" data-close-account aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="account-auth-tabs" role="tablist" aria-label="Connexion ou inscription">
        <button type="button" role="tab" aria-selected="${isLogin}" class="account-auth-tab ${isLogin ? "active" : ""}" data-auth-view="login">
          🔑 Se connecter
        </button>
        <button type="button" role="tab" aria-selected="${isRegister}" class="account-auth-tab ${isRegister ? "active" : ""}" data-auth-view="register">
          ✨ Créer un compte
        </button>
      </div>

      <div class="account-modal-body">
        <div id="auth-error-banner" class="auth-error-banner hidden" role="alert" aria-live="assertive"></div>

        ${
          isLogin
            ? `
            <form id="auth-login-form" method="POST" action="/api/auth/login" aria-labelledby="account-dialog-title" class="account-form">
              <div class="form-group">
                <label for="login-email" class="form-label">Adresse e-mail <span aria-hidden="true">*</span></label>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  class="form-control"
                  placeholder="vous@exemple.fr"
                  autocomplete="username"
                  spellcheck="false"
                  enterkeyhint="next"
                  autofocus
                  required
                  data-error="login-email-err"
                />
                <div id="login-email-err" class="field-error-msg">
                  <span role="img" aria-label="Erreur">⚠️</span> Saisissez une adresse e-mail valide.
                </div>
              </div>

              <div class="form-group">
                <div class="label-with-action">
                  <label for="login-password" class="form-label">Mot de passe <span aria-hidden="true">*</span></label>
                  <button type="button" class="inline-legal-btn" data-auth-view="forgot">Mot de passe oublié ?</button>
                </div>
                <div class="password-input-wrap">
                  <input
                    type="password"
                    id="login-password"
                    name="password"
                    class="form-control"
                    placeholder="Votre mot de passe"
                    autocomplete="current-password"
                    enterkeyhint="done"
                    required
                    data-error="login-pass-err"
                  />
                  <button
                    type="button"
                    class="btn-toggle-password"
                    data-toggle-pw="login-password"
                    aria-pressed="false"
                    aria-label="Afficher le mot de passe"
                    aria-describedby="login-pw-warn"
                  >👁️</button>
                </div>
                <span id="login-pw-warn" class="visually-hidden">Attention : cela affichera votre mot de passe à l'écran.</span>
                <div id="login-pass-err" class="field-error-msg">
                  <span role="img" aria-label="Erreur">⚠️</span> Veuillez saisir votre mot de passe.
                </div>
              </div>

              <label class="consent-checkbox-label">
                <input type="checkbox" id="login-remember" name="rememberMe" checked />
                <span>Rester connecté de manière sécurisée pendant 14 jours sur cet appareil</span>
              </label>

              <button type="submit" id="btn-auth-login-submit" class="btn btn-primary" style="width:100%;">
                Se connecter à mon compte
              </button>

              <p class="auth-switch-hint">
                Nouveau sur NEXUS SUBS ?
                <button type="button" class="inline-legal-btn" data-auth-view="register">Créer un compte sécurisé →</button>
              </p>
            </form>
          `
            : isRegister
            ? `
            <form id="auth-register-form" method="POST" action="/api/auth/register" aria-labelledby="account-dialog-title" class="account-form">
              <!-- Champ Honeypot Anti-Robot invisible -->
              <input type="text" id="reg-hp-field" name="website_url" class="visually-hidden" tabindex="-1" autocomplete="off" aria-hidden="true" />

              <div class="form-group">
                <label for="reg-name" class="form-label">Nom complet <span aria-hidden="true">*</span></label>
                <input
                  type="text"
                  id="reg-name"
                  name="fullName"
                  class="form-control"
                  placeholder="Ex : Camille Laurent"
                  autocomplete="name"
                  enterkeyhint="next"
                  minlength="2"
                  maxlength="80"
                  autofocus
                  required
                  data-error="reg-name-err"
                />
                <div id="reg-name-err" class="field-error-msg">
                  <span role="img" aria-label="Erreur">⚠️</span> Indiquez votre prénom et nom (2 à 80 caractères).
                </div>
              </div>

              <div class="form-group">
                <label for="reg-email" class="form-label">Adresse e-mail personnelle <span aria-hidden="true">*</span></label>
                <span id="reg-email-hint" class="input-hint">Utilisée pour sécuriser votre compte et rattacher vos commandes (adresses jetables refusées)</span>
                <input
                  type="email"
                  id="reg-email"
                  name="email"
                  class="form-control"
                  placeholder="vous@exemple.fr"
                  autocomplete="username"
                  spellcheck="false"
                  enterkeyhint="next"
                  aria-describedby="reg-email-hint"
                  required
                  data-error="reg-email-err"
                />
                <div id="reg-email-err" class="field-error-msg">
                  <span role="img" aria-label="Erreur">⚠️</span> Saisissez une adresse e-mail valide.
                </div>
              </div>

              <div class="form-group">
                <label for="reg-password" class="form-label">Mot de passe sécurisé <span aria-hidden="true">*</span></label>
                <span id="reg-pw-constraints" class="input-hint">10 caractères minimum avec 3 types parmi : majuscules, minuscules, chiffres, symboles.</span>
                <div class="password-input-wrap">
                  <input
                    type="password"
                    id="reg-password"
                    name="password"
                    class="form-control"
                    placeholder="Choisissez un mot de passe robuste"
                    autocomplete="new-password"
                    minlength="10"
                    maxlength="128"
                    enterkeyhint="done"
                    aria-describedby="reg-pw-constraints"
                    required
                    data-error="reg-pw-err"
                  />
                  <button
                    type="button"
                    class="btn-toggle-password"
                    data-toggle-pw="reg-password"
                    aria-pressed="false"
                    aria-label="Afficher le mot de passe"
                    aria-describedby="reg-pw-warn"
                  >👁️</button>
                </div>
                <span id="reg-pw-warn" class="visually-hidden">Attention : cela affichera votre mot de passe à l'écran.</span>
                <div id="reg-pw-meter" class="pw-strength-box" aria-live="polite">
                  <div class="pw-strength-track"><div id="reg-pw-bar" class="pw-strength-bar"></div></div>
                  <div class="pw-strength-meta">
                    <span id="reg-pw-label">Robustesse : —</span>
                    <div id="reg-pw-checks" class="pw-checks-row"></div>
                  </div>
                </div>
                <div id="reg-pw-err" class="field-error-msg">
                  <span role="img" aria-label="Erreur">⚠️</span> Minimum 10 caractères combinant majuscules, minuscules, chiffres ou symboles.
                </div>
              </div>

              <label class="consent-checkbox-label">
                <input type="checkbox" id="reg-consent" name="consent" required data-error="reg-consent-err" />
                <span>
                  J'accepte les <button type="button" class="inline-legal-btn" data-open-legal="cgv">CGV</button> et la
                  <button type="button" class="inline-legal-btn" data-open-legal="confidentialite">politique de confidentialité</button>.
                </span>
              </label>
              <div id="reg-consent-err" class="field-error-msg">
                <span role="img" aria-label="Erreur">⚠️</span> Veuillez accepter les conditions pour créer votre compte.
              </div>

              <button type="submit" id="btn-auth-register-submit" class="btn btn-primary" style="width:100%;">
                Créer mon compte sécurisé
              </button>

              <p class="auth-switch-hint">
                Vous avez déjà un compte ?
                <button type="button" class="inline-legal-btn" data-auth-view="login">Se connecter →</button>
              </p>
            </form>
          `
            : `
            <div class="account-forgot-stack">
              <form id="auth-forgot-form" method="POST" action="/api/auth/forgot-password" aria-labelledby="account-dialog-title" class="account-form">
                <p style="font-size:0.86rem;color:var(--text-secondary);">
                  Indiquez votre adresse e-mail pour recevoir un code de réinitialisation temporaire (valable 15 minutes).
                </p>
                <div class="form-group">
                  <label for="forgot-email" class="form-label">Votre adresse e-mail <span aria-hidden="true">*</span></label>
                  <input type="email" id="forgot-email" name="email" class="form-control" placeholder="vous@exemple.fr" autocomplete="username" spellcheck="false" required />
                </div>
                <button type="submit" id="btn-forgot-submit" class="btn btn-primary" style="width:100%;">
                  Recevoir un code de réinitialisation
                </button>
              </form>

              <form id="auth-reset-form" method="POST" action="/api/auth/reset-password" class="account-form hidden" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-light);">
                <div class="form-group">
                  <label for="reset-code" class="form-label">Code reçu par e-mail *</label>
                  <input type="text" id="reset-code" name="resetCode" class="form-control" placeholder="Ex : 482910-A4F2" autocomplete="one-time-code" spellcheck="false" required />
                </div>
                <div class="form-group">
                  <label for="reset-new-pw" class="form-label">Nouveau mot de passe sécurisé (10 caract. min.) *</label>
                  <input type="password" id="reset-new-pw" name="newPassword" class="form-control" autocomplete="new-password" minlength="10" required />
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;">Enregistrer mon nouveau mot de passe</button>
              </form>

              <p class="auth-switch-hint">
                <button type="button" class="inline-legal-btn" data-auth-view="login">← Retour à la connexion</button>
              </p>
            </div>
          `
        }

        <div class="account-security-footnote">
          <span>🔒 Mots de passe hachés scrypt • Cookies HttpOnly • Protection anti-force brute &amp; anti-fraude active</span>
        </div>
      </div>
    `;
  }

  bindAuthEvents(dialog, container) {
    container.querySelector("[data-close-account]")?.addEventListener("click", () => closeDialogSmoothly(dialog));
    container.querySelectorAll("[data-open-legal]").forEach((btn) => {
      btn.addEventListener("click", () => window.openLegalModal?.(btn.getAttribute("data-open-legal")));
    });

    container.querySelectorAll("[data-auth-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeView = btn.getAttribute("data-auth-view") || "login";
        this.formOpenedAtMs = Date.now();
        this.renderDialog();
      });
    });

    // Toggle Afficher / Masquer mot de passe (avec aria-pressed)
    container.querySelectorAll("[data-toggle-pw]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-toggle-pw");
        const input = container.querySelector(`#${targetId}`);
        if (!input) return;
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        btn.setAttribute("aria-pressed", showing ? "false" : "true");
        btn.setAttribute("aria-label", showing ? "Afficher le mot de passe" : "Masquer le mot de passe");
        btn.textContent = showing ? "👁️" : "🙈";
      });
    });

    const showErr = (msg) => {
      const box = container.querySelector("#auth-error-banner");
      if (!box) return;
      box.textContent = msg;
      box.classList.remove("hidden");
    };
    const clearErr = () => {
      const box = container.querySelector("#auth-error-banner");
      if (box) {
        box.textContent = "";
        box.classList.add("hidden");
      }
    };

    // Indicateur de robustesse de mot de passe en direct (inscription)
    const regPw = container.querySelector("#reg-password");
    if (regPw) {
      const updateMeter = () => {
        const emailVal = container.querySelector("#reg-email")?.value || "";
        const nameVal = container.querySelector("#reg-name")?.value || "";
        const res = evaluateClientPasswordStrength(regPw.value, emailVal, nameVal);
        const bar = container.querySelector("#reg-pw-bar");
        const lbl = container.querySelector("#reg-pw-label");
        const checksBox = container.querySelector("#reg-pw-checks");
        if (bar) {
          bar.style.width = `${res.score}%`;
          bar.className = `pw-strength-bar level-${res.level}`;
        }
        if (lbl) {
          lbl.textContent = res.levelLabel ? `Robustesse : ${res.levelLabel} (${res.score}%)` : "Robustesse : —";
        }
        if (checksBox) {
          checksBox.innerHTML = res.checks
            .map((c) => `<span class="pw-check-chip ${c.ok ? "ok" : ""}">${c.ok ? "✓" : "•"} ${c.label}</span>`)
            .join("");
        }
      };
      regPw.addEventListener("input", updateMeter);
      updateMeter();
    }

    // Soumission Connexion
    const loginForm = container.querySelector("#auth-login-form");
    loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErr();
      if (this.inFlight) return;
      if (!loginForm.checkValidity()) {
        loginForm.reportValidity();
        loginForm.querySelector(":invalid")?.focus();
        return;
      }

      const btn = container.querySelector("#btn-auth-login-submit");
      this.inFlight = true;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-icon"></span><span>Connexion sécurisée...</span>`;
      }

      try {
        const resp = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            email: container.querySelector("#login-email").value.trim(),
            password: container.querySelector("#login-password").value,
            rememberMe: Boolean(container.querySelector("#login-remember")?.checked),
            ...siteTracker.getPayloadMeta()
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          siteTracker.track("auth_login_fail", "Échec connexion", { ok: false });
          throw new Error(data.error || "Connexion impossible.");
        }

        this.authenticated = true;
        this.user = data.user;
        this.csrfToken = data.csrfToken || "";
        this.sessions = data.sessions || [];
        this.orders = data.orders || [];
        this.discussions = data.discussions || [];
        this.activeView = "overview";
        siteTracker.track("auth_login_success", "Connexion réussie", { ok: true });
        this.emit();
        this.broadcastSync("login");
        showToast(`Ravi de vous revoir, ${getFirstName(this.user.name)} !`, "success");
        this.renderDialog();
      } catch (err) {
        showErr(err.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Se connecter à mon compte";
        }
      } finally {
        this.inFlight = false;
      }
    });

    // Soumission Inscription
    const regForm = container.querySelector("#auth-register-form");
    regForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErr();
      if (this.inFlight) return;
      if (!regForm.checkValidity()) {
        regForm.reportValidity();
        regForm.querySelector(":invalid")?.focus();
        return;
      }

      const fullName = container.querySelector("#reg-name").value.trim();
      const email = container.querySelector("#reg-email").value.trim();
      const password = container.querySelector("#reg-password").value;
      const strength = evaluateClientPasswordStrength(password, email, fullName);
      if (!strength.valid) {
        showErr(
          strength.containsEmail || strength.containsName
            ? "Votre mot de passe ne doit contenir ni votre nom ni votre adresse e-mail."
            : "Mot de passe trop faible : utilisez au moins 10 caractères avec majuscules, minuscules, chiffres ou symboles."
        );
        container.querySelector("#reg-password")?.focus();
        return;
      }

      const btn = container.querySelector("#btn-auth-register-submit");
      this.inFlight = true;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-icon"></span><span>Création et sécurisation...</span>`;
      }

      try {
        const resp = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            fullName,
            email,
            password,
            honeypot: container.querySelector("#reg-hp-field")?.value || "",
            formFillMs: this.formOpenedAtMs ? Date.now() - this.formOpenedAtMs : 5000,
            ...siteTracker.getPayloadMeta()
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          siteTracker.track("auth_register_attempt", "Échec inscription", { ok: false });
          throw new Error(data.error || "Impossible de créer le compte.");
        }

        this.authenticated = true;
        this.user = data.user;
        this.csrfToken = data.csrfToken || "";
        this.sessions = data.sessions || [];
        this.orders = data.orders || [];
        this.discussions = data.discussions || [];
        this.activeView = "overview";
        siteTracker.track("auth_register_attempt", "Inscription réussie", { ok: true });
        this.emit();
        this.broadcastSync("login");
        showToast(`Compte créé avec succès ! Bienvenue ${getFirstName(this.user.name)}.`, "success", 4500);
        this.renderDialog();
      } catch (err) {
        showErr(err.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Créer mon compte sécurisé";
        }
      } finally {
        this.inFlight = false;
      }
    });

    // Mot de passe oublié
    const forgotForm = container.querySelector("#auth-forgot-form");
    forgotForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErr();
      const email = container.querySelector("#forgot-email")?.value.trim() || "";
      if (!email) return;
      try {
        const resp = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Erreur.");
        showToast(data.message, "info", 6500);
        if (data.smtpConfigured) {
          container.querySelector("#auth-reset-form")?.classList.remove("hidden");
        }
      } catch (err) {
        showErr(err.message);
      }
    });

    container.querySelector("#auth-reset-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErr();
      try {
        const resp = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: container.querySelector("#forgot-email")?.value.trim() || "",
            resetCode: container.querySelector("#reset-code")?.value.trim() || "",
            newPassword: container.querySelector("#reset-new-pw")?.value || ""
          })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Erreur de réinitialisation.");
        showToast(data.message, "success", 5000);
        this.activeView = "login";
        this.renderDialog();
      } catch (err) {
        showErr(err.message);
      }
    });
  }

  renderAccountDashboard() {
    const u = this.user;
    const tab = this.activeView;
    const memberSince = new Date(u.createdAt).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });

    return `
      <div class="checkout-header">
        <div class="checkout-header-title">
          <div class="account-menu-avatar-lg" aria-hidden="true">${escapeHtml(getInitials(u.name))}</div>
          <div>
            <div class="live-order-title-row">
              <h1 id="account-dialog-title" class="checkout-title">${escapeHtml(u.name)}</h1>
              <span class="live-sync-pill"><span class="sync-dot"></span>Compte sécurisé actif</span>
            </div>
            <p class="checkout-subtitle">${escapeHtml(u.email)} • Membre depuis le ${memberSince}</p>
          </div>
        </div>
        <div class="header-dialog-btns">
          <button type="button" class="btn btn-outline btn-xs danger-btn" id="btn-account-logout">Déconnexion</button>
          <button type="button" class="btn-close-dialog" data-close-account aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="account-auth-tabs" role="tablist" aria-label="Espace client">
        <button type="button" role="tab" aria-selected="${tab === "overview"}" class="account-auth-tab ${tab === "overview" ? "active" : ""}" data-acct-tab="overview">
          📦 Mes Commandes (${this.orders.length})
        </button>
        <button type="button" role="tab" aria-selected="${tab === "discussions"}" class="account-auth-tab ${tab === "discussions" ? "active" : ""}" data-acct-tab="discussions">
          💬 Mes Discussions (${this.discussions.length})
        </button>
        <button type="button" role="tab" aria-selected="${tab === "security"}" class="account-auth-tab ${tab === "security" ? "active" : ""}" data-acct-tab="security">
          🛡️ Profil &amp; Sécurité (${this.sessions.length})
        </button>
      </div>

      <div class="account-modal-body">
        ${
          tab === "overview"
            ? this.renderOverviewTab()
            : tab === "discussions"
            ? this.renderDiscussionsTab()
            : this.renderSecurityTab()
        }
      </div>
    `;
  }

  renderOverviewTab() {
    if (this.orders.length === 0) {
      return `
        <div class="admin-empty-state">
          <p><strong>Aucune commande associée à votre compte pour le moment.</strong></p>
          <p style="margin-top:0.35rem;">Toutes vos futures commandes (et celles passées avec <code>${escapeHtml(this.user.email)}</code>) apparaîtront ici automatiquement avec vos accès chiffrés.</p>
          <button type="button" class="btn btn-primary btn-xs" style="margin-top:0.9rem;" id="btn-acct-go-catalog">Découvrir nos offres 12 mois</button>
        </div>
      `;
    }

    return `
      <div class="account-orders-list">
        ${this.orders
          .map((ord) => {
            const isPaid = ord.paymentStatus === "paid";
            const isDelivered = ord.deliveryStatus === "delivered";
            return `
              <div class="account-order-row">
                <div>
                  <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                    <strong class="order-badge-id">#${escapeHtml(ord.orderId)}</strong>
                    <span class="order-status-badge ${isPaid ? "badge-paid" : "badge-waiting"}">
                      ${isPaid ? "✓ Payé" : ord.paymentStatus === "declaration_sent" ? "⚡ Vérification" : "⏳ En attente"}
                    </span>
                    <span class="order-status-badge ${isDelivered ? "badge-paid" : ""}">
                      ${isDelivered ? "📦 Accès livrés" : "En préparation"}
                    </span>
                  </div>
                  <p style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.25rem;">
                    ${(ord.items || []).map((i) => `${i.quantity}× ${escapeHtml(i.title)}`).join(" • ")} — <strong>${ord.total} €</strong>
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-primary btn-xs"
                  data-acct-open-order="${escapeHtml(ord.orderId)}"
                  data-acct-order-token="${escapeHtml(ord.accessToken || "")}"
                >
                  Ouvrir mon coffre →
                </button>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderDiscussionsTab() {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;flex-wrap:wrap;gap:0.5rem;">
        <p style="font-size:0.85rem;color:var(--text-muted);">Retrouvez tous vos échanges avec nos conseillers NEXUS.</p>
        <button type="button" class="btn btn-primary btn-xs" id="btn-acct-new-disc">+ Nouvelle discussion</button>
      </div>
      ${
        this.discussions.length === 0
          ? `<div class="admin-empty-state"><p>Vous n'avez pas encore ouvert de discussion.</p></div>`
          : `
            <div class="account-orders-list">
              ${this.discussions
                .map(
                  (t) => `
                  <div class="account-order-row">
                    <div>
                      <strong>${escapeHtml(t.topicLabel || "Discussion")}</strong>
                      <p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem;">
                        ${t.status === "resolved" ? "✅ Résolue" : "🟢 Ouverte"} •
                        Mis à jour le ${new Date(t.updatedAt || t.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="btn btn-secondary btn-xs"
                      data-acct-open-disc="${escapeHtml(t.threadId)}"
                      data-acct-disc-token="${escapeHtml(t.threadToken || "")}"
                    >
                      Reprendre →
                    </button>
                  </div>
                `
                )
                .join("")}
            </div>
          `
      }
    `;
  }

  renderSecurityTab() {
    return `
      <div class="account-security-grid">
        <form id="acct-profile-form" class="account-sec-card">
          <h2>Informations du profil</h2>
          <div class="form-group">
            <label for="acct-edit-name" class="form-label">Nom complet</label>
            <input type="text" id="acct-edit-name" name="fullName" class="form-control" value="${escapeHtml(this.user.name)}" autocomplete="name" minlength="2" maxlength="80" required />
          </div>
          <div class="form-group">
            <label class="form-label">Adresse e-mail (identifiant sécurisé)</label>
            <input type="email" class="form-control" value="${escapeHtml(this.user.email)}" disabled />
          </div>
          <button type="submit" class="btn btn-secondary btn-xs" style="align-self:flex-start;">Enregistrer le profil</button>
        </form>

        <form id="acct-changepw-form" class="account-sec-card">
          <h2>Changer mon mot de passe</h2>
          <p style="font-size:0.78rem;color:var(--text-muted);">Par sécurité, modifier votre mot de passe déconnecte automatiquement tous vos autres appareils.</p>
          <div class="form-group">
            <label for="acct-cur-pw" class="form-label">Mot de passe actuel *</label>
            <input type="password" id="acct-cur-pw" name="currentPassword" class="form-control" autocomplete="current-password" required />
          </div>
          <div class="form-group">
            <label for="acct-new-pw" class="form-label">Nouveau mot de passe (10 caract. min.) *</label>
            <input type="password" id="acct-new-pw" name="newPassword" class="form-control" autocomplete="new-password" minlength="10" required />
          </div>
          <button type="submit" class="btn btn-primary btn-xs" style="align-self:flex-start;">Mettre à jour le mot de passe</button>
        </form>
      </div>

      <div class="account-sec-card" style="margin-top:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <h2>Appareils &amp; Sessions actives (${this.sessions.length})</h2>
            <p style="font-size:0.78rem;color:var(--text-muted);">Maximum 5 sessions simultanées protégées par cookie HttpOnly.</p>
          </div>
          ${
            this.sessions.length > 1
              ? `<button type="button" class="btn btn-outline btn-xs danger-btn" id="btn-revoke-other-sessions">Déconnecter les autres appareils</button>`
              : ""
          }
        </div>
        <div class="account-sessions-list">
          ${this.sessions
            .map(
              (s) => `
              <div class="account-session-row">
                <div>
                  <strong>${escapeHtml(s.userAgentSummary || "Navigateur")} ${s.isCurrent ? '<span class="pm-pill-badge">Cet appareil</span>' : ""}</strong>
                  <span style="display:block;font-size:0.74rem;color:var(--text-muted);">
                    Dernière activité : ${new Date(s.lastSeenAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                ${
                  !s.isCurrent
                    ? `<button type="button" class="btn btn-outline btn-xs danger-btn" data-revoke-session="${escapeHtml(s.id)}">Révoquer</button>`
                    : ""
                }
              </div>
            `
            )
            .join("")}
        </div>
      </div>

      ${
        (this.user.securityLog || []).length > 0
          ? `
          <div class="account-sec-card" style="margin-top:1rem;">
            <h2>Journal de sécurité récent</h2>
            <ul class="account-seclog-list">
              ${this.user.securityLog
                .slice(0, 6)
                .map(
                  (ev) => `
                  <li>
                    <span><strong>${escapeHtml(ev.action)}</strong>${ev.detail ? ` — ${escapeHtml(ev.detail)}` : ""}</span>
                    <span class="text-subtle-sm">${new Date(ev.at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </li>
                `
                )
                .join("")}
            </ul>
          </div>
        `
          : ""
      }
    `;
  }

  bindDashboardEvents(dialog, container) {
    container.querySelector("[data-close-account]")?.addEventListener("click", () => closeDialogSmoothly(dialog));
    container.querySelector("#btn-account-logout")?.addEventListener("click", () => this.logout());

    container.querySelectorAll("[data-acct-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeView = btn.getAttribute("data-acct-tab") || "overview";
        this.renderDialog();
      });
    });

    container.querySelector("#btn-acct-go-catalog")?.addEventListener("click", async () => {
      await closeDialogSmoothly(dialog);
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    });

    container.querySelectorAll("[data-acct-open-order]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const orderId = btn.getAttribute("data-acct-open-order");
        const accessToken = btn.getAttribute("data-acct-order-token");
        await closeDialogSmoothly(dialog);
        openLiveOrderDialog({ orderId, accessToken });
      });
    });

    container.querySelector("#btn-acct-new-disc")?.addEventListener("click", async () => {
      await closeDialogSmoothly(dialog);
      openCustomerDiscussion();
    });

    container.querySelectorAll("[data-acct-open-disc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const threadId = btn.getAttribute("data-acct-open-disc");
        const token = btn.getAttribute("data-acct-disc-token");
        const found = this.discussions.find((d) => d.threadId === threadId);
        await closeDialogSmoothly(dialog);
        openCustomerDiscussion({ resumeThread: found || null, resumeToken: token });
      });
    });

    container.querySelector("#acct-profile-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fullName = container.querySelector("#acct-edit-name")?.value.trim() || "";
      try {
        const resp = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": this.csrfToken },
          credentials: "same-origin",
          body: JSON.stringify({ fullName })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Erreur.");
        this.user = data.user;
        this.emit();
        showToast("Profil mis à jour avec succès !", "success");
        this.renderDialog();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    container.querySelector("#acct-changepw-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPassword = container.querySelector("#acct-cur-pw")?.value || "";
      const newPassword = container.querySelector("#acct-new-pw")?.value || "";
      try {
        const resp = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": this.csrfToken },
          credentials: "same-origin",
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Modification impossible.");
        this.csrfToken = data.csrfToken || this.csrfToken;
        this.sessions = data.sessions || this.sessions;
        this.user = data.user || this.user;
        showToast("Mot de passe modifié ! Toutes les autres sessions ont été déconnectées.", "success", 5000);
        this.renderDialog();
      } catch (err) {
        showToast(err.message, "error", 5000);
      }
    });

    container.querySelector("#btn-revoke-other-sessions")?.addEventListener("click", async () => {
      const resp = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": this.csrfToken },
        credentials: "same-origin",
        body: JSON.stringify({ revokeOthers: true })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        this.sessions = data.sessions || [];
        this.user = data.user || this.user;
        showToast("Tous les autres appareils ont été déconnectés.", "success");
        this.renderDialog();
      }
    });

    container.querySelectorAll("[data-revoke-session]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sessionId = btn.getAttribute("data-revoke-session");
        const resp = await fetch("/api/auth/sessions/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": this.csrfToken },
          credentials: "same-origin",
          body: JSON.stringify({ sessionId })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          this.sessions = data.sessions || [];
          showToast("Session révoquée.", "info");
          this.renderDialog();
        }
      });
    });
  }
}

export const account = new AccountController();
