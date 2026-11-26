/**
 * Espace Administrateur Complet (v3) :
 * - Menu "💬 Discussions" avec mise en page Split-View claire et diagnostics précis en direct :
 *   • "⏳ En attente depuis X" (rafraîchi en continu avec Intl.DurationFormat)
 *   • "⚡ Nécessite de l'aide rapide"
 *   • "😤 Agacé"
 *   • "🚨 Suspecté de fraude" (avec score & raisons détaillées + blocage 1-clic)
 * - Catalogue : Prix, Prix barrés, Disponibilités & Stocks en 1 clic
 * - Commandes & Livraison directe (Coffre chiffré sur le site + E-mail) + Alertes Anti-Fraude
 * - Notifications Téléphone (QR ntfy) & Configuration Stripe / PayPal / SEPA / Sécurité Admin
 */

import { store } from "./store.js";
import { closeDialogSmoothly, showToast, playChime, escapeHtml } from "./mwg-helpers.js";

const ADMIN_TOKEN_KEY = "nexus_admin_jwt_v2";

function formatLiveWaitingLabel(waitingSinceIso) {
  if (!waitingSinceIso) return null;
  const totalMins = Math.max(0, Math.floor((Date.now() - new Date(waitingSinceIso).getTime()) / 60000));
  if (totalMins < 1) return "En attente depuis < 1 min";

  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const minutes = totalMins % 60;

  if (typeof Intl !== "undefined" && typeof Intl.DurationFormat === "function") {
    const df = new Intl.DurationFormat("fr-FR", { style: "short" });
    const parts = {};
    if (days > 0) parts.days = days;
    if (hours > 0) parts.hours = hours;
    if (days === 0 && minutes > 0) parts.minutes = minutes;
    return `En attente depuis ${df.format(parts)}`;
  }

  if (days > 0) return `En attente depuis ${days}j ${hours}h`;
  if (hours > 0) return minutes > 0 ? `En attente depuis ${hours}h ${minutes}min` : `En attente depuis ${hours}h`;
  return `En attente depuis ${minutes} min`;
}

class AdminController {
  constructor() {
    this.token = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
    this.dashboard = null;
    this.activeTab = "discussions"; // 'discussions' | 'orders' | 'catalog' | 'integrations' | 'coupons'
    this.orderFilter = "all";
    this.discFilter = "all"; // 'all' | 'fast_help' | 'waiting' | 'annoyed' | 'fraud' | 'resolved'
    this.selectedThreadId = null;
    this.adminSse = null;
    this.pendingDeepLinkOrderId = null;
    this.pendingDeepLinkThreadId = null;
    this.liveTimerInterval = null;
  }

  init() {
    if (this.token) {
      this.refreshDashboardSilently();
    }
    // Rafraîchir les compteurs "En attente depuis X" toutes les 30s si le menu Admin est ouvert
    this.liveTimerInterval = setInterval(() => {
      const dialog = document.getElementById("admin-dialog");
      if (dialog?.open && this.activeTab === "discussions" && this.dashboard) {
        document.querySelectorAll("[data-waiting-since]").forEach((el) => {
          const iso = el.getAttribute("data-waiting-since");
          if (iso) el.textContent = `⏳ ${formatLiveWaitingLabel(iso)}`;
        });
      }
    }, 30000);
  }

  authHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`
    };
  }

  async refreshDashboardSilently() {
    try {
      const resp = await fetch("/api/admin/dashboard", { headers: this.authHeaders() });
      if (!resp.ok) {
        this.token = "";
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        this.updateHeaderIndicators();
        return false;
      }
      this.dashboard = await resp.json();
      this.updateHeaderIndicators();
      this.connectAdminSse();
      return true;
    } catch {
      return false;
    }
  }

  connectAdminSse() {
    if (this.adminSse || !this.token) return;
    try {
      const es = new EventSource(`/api/events/admin?adminToken=${encodeURIComponent(this.token)}`);
      const onEvent = async (evtName) => {
        await this.refreshDashboardSilently();
        if (evtName === "order_created" || evtName === "discussion_updated" || evtName === "notification") {
          playChime("delivery");
        }
        const adminDialog = document.getElementById("admin-dialog");
        if (adminDialog?.open) this.render({ preserveChatDraft: true });
      };
      es.addEventListener("order_created", () => onEvent("order_created"));
      es.addEventListener("order_updated", () => onEvent("order_updated"));
      es.addEventListener("discussion_updated", () => onEvent("discussion_updated"));
      es.addEventListener("notification", () => onEvent("notification"));
      es.addEventListener("support_message", () => onEvent("support_message"));
      this.adminSse = es;
    } catch {
      // ignore
    }
  }

  updateHeaderIndicators() {
    const dot = document.getElementById("admin-status-dot");
    const badge = document.getElementById("admin-notif-badge");
    const isLogged = Boolean(this.token && this.dashboard);

    if (dot) dot.classList.toggle("online", isLogged);
    if (badge) {
      const s = this.dashboard?.stats || {};
      const count = isLogged ? (s.pendingDeliveries || 0) + (s.openWaitingDiscussions || 0) : 0;
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.toggle("hidden", count === 0);
    }
  }

  async openModal(tab = null, { orderId = null, threadId = null } = {}) {
    const dialog = document.getElementById("admin-dialog");
    if (!dialog) return;

    if (tab) this.activeTab = tab;
    if (orderId) {
      this.pendingDeepLinkOrderId = orderId;
      this.activeTab = "orders";
    }
    if (threadId) {
      this.pendingDeepLinkThreadId = threadId;
      this.selectedThreadId = threadId;
      this.activeTab = "discussions";
    }

    if (this.token) {
      await this.refreshDashboardSilently();
    }

    this.render();
    if (!dialog.open) dialog.showModal();

    if (this.token && this.dashboard && this.pendingDeepLinkOrderId) {
      const targetId = this.pendingDeepLinkOrderId;
      this.pendingDeepLinkOrderId = null;
      this.openDeliverOrderDialog(targetId);
    }
  }

  logout() {
    fetch("/api/admin/logout", { method: "POST", headers: this.authHeaders() }).catch(() => {});
    this.token = "";
    this.dashboard = null;
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    if (this.adminSse) {
      this.adminSse.close();
      this.adminSse = null;
    }
    this.updateHeaderIndicators();
    this.render();
    showToast("Déconnexion administrateur effectuée.", "info");
  }

  render({ preserveChatDraft = false } = {}) {
    const dialog = document.getElementById("admin-dialog");
    const container = document.getElementById("admin-dialog-content");
    if (!container) return;

    const savedDraft = preserveChatDraft ? container.querySelector("#admin-disc-reply-input")?.value || "" : "";

    if (!this.token || !this.dashboard) {
      container.innerHTML = `
        <div class="admin-modal-header">
          <div class="admin-header-title">
            <div class="admin-icon-badge" aria-hidden="true">🔐</div>
            <div>
              <h1 id="admin-dialog-title" class="admin-title">Connexion Compte Administrateur</h1>
              <p class="admin-subtitle">Accès protégé par chiffrement scrypt &amp; verrouillage anti-force brute</p>
            </div>
          </div>
          <button type="button" class="btn-close-dialog" data-close-admin aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="admin-modal-body">
          <form id="admin-login-form" class="admin-login-form">
            <div class="form-group">
              <label for="admin-login-email" class="form-label">E-mail administrateur *</label>
              <input
                type="email"
                id="admin-login-email"
                class="form-control"
                value="subpassdelivrey@gmail.com"
                autocomplete="username"
                required
              />
            </div>

            <div class="form-group">
              <label for="admin-login-pass" class="form-label">Mot de passe secret *</label>
              <input
                type="password"
                id="admin-login-pass"
                class="form-control"
                placeholder="Saisissez votre mot de passe admin"
                autocomplete="current-password"
                autofocus
                required
              />
            </div>

            <button type="submit" class="btn btn-primary" style="width:100%">
              Se connecter à l'Espace Admin
            </button>
          </form>
        </div>
      `;

      container.querySelector("[data-close-admin]")?.addEventListener("click", () => closeDialogSmoothly(dialog));
      container.querySelector("#admin-login-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = container.querySelector("#admin-login-email").value.trim();
        const password = container.querySelector("#admin-login-pass").value;
        try {
          const resp = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || "Identifiants refusés.");

          this.token = data.token;
          localStorage.setItem(ADMIN_TOKEN_KEY, this.token);
          await this.refreshDashboardSilently();
          showToast("Connexion Administrateur réussie !", "success");
          this.render();

          if (this.pendingDeepLinkOrderId) {
            const targetOrder = this.pendingDeepLinkOrderId;
            this.pendingDeepLinkOrderId = null;
            this.openDeliverOrderDialog(targetOrder);
          }
        } catch (err) {
          showToast(err.message, "error", 5000);
        }
      });
      return;
    }

    const d = this.dashboard;

    container.innerHTML = `
      <div class="admin-modal-header">
        <div class="admin-header-title">
          <div class="admin-icon-badge logged" aria-hidden="true">🛡️</div>
          <div>
            <div class="admin-header-badge-row">
              <h1 id="admin-dialog-title" class="admin-title">Centre de Contrôle NEXUS</h1>
              <span class="badge-admin-status">● Connecté en direct</span>
            </div>
            <p class="admin-subtitle">
              ${escapeHtml(d.admin.name)} • CA : <strong>${d.stats.totalRevenue} €</strong> •
              À livrer : <strong>${d.stats.pendingDeliveries}</strong> •
              Discussions en attente : <strong>${d.stats.openWaitingDiscussions || 0}</strong>
            </p>
          </div>
        </div>
        <div class="admin-header-actions">
          <button type="button" class="btn btn-outline btn-xs" id="btn-admin-logout">Déconnexion</button>
          <button type="button" class="btn-close-dialog" data-close-admin aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="admin-tabs-nav mwg-tablist-scroller" role="tablist" aria-label="Sections Administration">
        <button type="button" role="tab" aria-selected="${this.activeTab === "discussions"}" class="admin-tab-btn ${this.activeTab === "discussions" ? "active" : ""}" data-admin-tab="discussions">
          <span>💬 Discussions</span>
          ${
            (d.stats.urgentDiscussionsCount || 0) > 0
              ? `<span class="tab-badge-count">${d.stats.urgentDiscussionsCount} urg.</span>`
              : `<span class="tab-badge-count muted">${d.discussions.length}</span>`
          }
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "orders"}" class="admin-tab-btn ${this.activeTab === "orders" ? "active" : ""}" data-admin-tab="orders">
          <span>⚡ Commandes &amp; Livraison</span>
          ${d.stats.pendingDeliveries > 0 ? `<span class="tab-badge-count">${d.stats.pendingDeliveries}</span>` : `<span class="tab-badge-count muted">${d.orders.length}</span>`}
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "catalog"}" class="admin-tab-btn ${this.activeTab === "catalog" ? "active" : ""}" data-admin-tab="catalog">
          <span>📦 Prix &amp; Disponibilités (${d.products.length})</span>
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "integrations"}" class="admin-tab-btn ${this.activeTab === "integrations" ? "active" : ""}" data-admin-tab="integrations">
          <span>📲 Téléphone, Paiements &amp; Sécurité</span>
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "coupons"}" class="admin-tab-btn ${this.activeTab === "coupons" ? "active" : ""}" data-admin-tab="coupons">
          <span>🏷️ Codes Promo (${d.coupons.length})</span>
        </button>
      </div>

      <div class="admin-dashboard-body">
        ${this.renderTabBody(d, savedDraft)}
      </div>
    `;

    container.querySelector("[data-close-admin]")?.addEventListener("click", () => closeDialogSmoothly(dialog));
    container.querySelector("#btn-admin-logout")?.addEventListener("click", () => this.logout());

    container.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeTab = btn.getAttribute("data-admin-tab");
        this.render();
      });
    });

    this.bindActiveTabEvents(container);
  }

  renderTabBody(d, savedDraft = "") {
    if (this.activeTab === "discussions") return this.renderDiscussionsMenu(d, savedDraft);
    if (this.activeTab === "orders") return this.renderOrdersTab(d.orders, d.stats);
    if (this.activeTab === "catalog") return this.renderCatalogTab(d.products);
    if (this.activeTab === "integrations") return this.renderIntegrationsTab(d.settings, d.ntfyInfo, d.admin, d.security);
    return this.renderCouponsTab(d.coupons);
  }

  // ==========================================================================
  // MENU "DISCUSSIONS" : SPLIT-VIEW CLAIRE & INDICATIONS PRÉCISES EN DIRECT
  // ==========================================================================
  renderDiscussionsMenu(d, savedDraft = "") {
    const threads = d.discussions || [];

    const countFast = threads.filter((t) => !t.diagnostics.isResolved && t.diagnostics.needsFastHelp).length;
    const countWaiting = threads.filter((t) => !t.diagnostics.isResolved && t.diagnostics.waitingSince).length;
    const countAnnoyed = threads.filter((t) => !t.diagnostics.isResolved && t.diagnostics.isAnnoyed).length;
    const countFraud = threads.filter((t) => t.diagnostics.isSuspectedFraud).length;
    const countResolved = threads.filter((t) => t.diagnostics.isResolved).length;

    const filtered = threads.filter((t) => {
      const dg = t.diagnostics;
      if (this.discFilter === "fast_help") return !dg.isResolved && dg.needsFastHelp;
      if (this.discFilter === "waiting") return !dg.isResolved && Boolean(dg.waitingSince);
      if (this.discFilter === "annoyed") return !dg.isResolved && dg.isAnnoyed;
      if (this.discFilter === "fraud") return dg.isSuspectedFraud;
      if (this.discFilter === "resolved") return dg.isResolved;
      return true;
    });

    if (!this.selectedThreadId || !filtered.some((t) => t.threadId === this.selectedThreadId)) {
      this.selectedThreadId = filtered[0]?.threadId || null;
    }

    const activeThread = filtered.find((t) => t.threadId === this.selectedThreadId) || null;
    const isBlockedClient =
      activeThread &&
      (d.security?.blockedEmails || []).includes((activeThread.customerEmail || "").toLowerCase());

    return `
      <!-- Barre de filtres diagnostics précis -->
      <div class="disc-admin-filters-bar">
        <button type="button" class="filter-pill ${this.discFilter === "all" ? "active" : ""}" data-disc-filter="all">
          Toutes (${threads.length})
        </button>
        <button type="button" class="filter-pill pill-filter-urgent ${this.discFilter === "fast_help" ? "active" : ""}" data-disc-filter="fast_help">
          ⚡ Nécessite de l'aide rapide (${countFast})
        </button>
        <button type="button" class="filter-pill ${this.discFilter === "waiting" ? "active" : ""}" data-disc-filter="waiting">
          ⏳ En attente (${countWaiting})
        </button>
        <button type="button" class="filter-pill pill-filter-annoyed ${this.discFilter === "annoyed" ? "active" : ""}" data-disc-filter="annoyed">
          😤 Agacé (${countAnnoyed})
        </button>
        <button type="button" class="filter-pill pill-filter-fraud ${this.discFilter === "fraud" ? "active" : ""}" data-disc-filter="fraud">
          🚨 Suspecté de fraude (${countFraud})
        </button>
        <button type="button" class="filter-pill ${this.discFilter === "resolved" ? "active" : ""}" data-disc-filter="resolved">
          ✅ Résolues (${countResolved})
        </button>
      </div>

      ${
        filtered.length === 0
          ? `
            <div class="admin-empty-state">
              <p><strong>Aucune discussion dans ce filtre pour le moment.</strong></p>
              <p style="margin-top:0.35rem;">Dès qu'un visiteur pose une question (sur toute la boutique ou sur un article précis) ou ouvre un ticket de secours, sa conversation apparaît ici en direct avec ses indicateurs automatiques.</p>
            </div>
          `
          : `
            <div class="admin-discussions-split">
              <!-- Colonne Gauche : Liste claire des conversations avec badges précis -->
              <div class="admin-disc-list-pane">
                ${filtered
                  .map((t) => {
                    const dg = t.diagnostics;
                    const isSelected = t.threadId === activeThread?.threadId;
                    const liveWait = dg.waitingSince ? formatLiveWaitingLabel(dg.waitingSince) : null;

                    return `
                      <button
                        type="button"
                        class="admin-disc-item-card ${isSelected ? "selected" : ""} ${dg.needsFastHelp ? "urgent-border" : ""} ${dg.isSuspectedFraud ? "fraud-border" : ""}"
                        data-select-thread="${escapeHtml(t.threadId)}"
                      >
                        <div class="disc-card-row-top">
                          <div class="disc-client-ident">
                            <strong>${escapeHtml(t.customerName || "Visiteur")}</strong>
                            ${t.unreadByAdmin > 0 ? `<span class="unread-dot-count">${t.unreadByAdmin}</span>` : ""}
                          </div>
                          <span class="disc-topic-mini-tag">${escapeHtml(t.topicLabel || "Général")}</span>
                        </div>

                        <!-- Indications précises automatiques -->
                        <div class="disc-diagnostic-badges">
                          ${
                            liveWait
                              ? `<span class="diag-badge diag-wait-${dg.waitingLevel}" data-waiting-since="${escapeHtml(dg.waitingSince)}">⏳ ${escapeHtml(liveWait)}</span>`
                              : ""
                          }
                          ${dg.needsFastHelp ? `<span class="diag-badge diag-fast-help">⚡ Nécessite de l'aide rapide</span>` : ""}
                          ${dg.isAnnoyed ? `<span class="diag-badge diag-annoyed">😤 Agacé</span>` : ""}
                          ${dg.isSuspectedFraud ? `<span class="diag-badge diag-fraud">🚨 Suspecté de fraude (${dg.riskScore}%)</span>` : ""}
                          ${dg.isResolved ? `<span class="diag-badge diag-resolved">✅ Résolu</span>` : ""}
                        </div>

                        <p class="disc-preview-snippet">${escapeHtml(dg.lastMessagePreview)}</p>
                      </button>
                    `;
                  })
                  .join("")}
              </div>

              <!-- Colonne Droite : Fiche Diagnostic + Fil de Discussion & Actions 1-Clic -->
              <div class="admin-disc-detail-pane">
                ${activeThread ? this.renderSelectedDiscussionDetail(activeThread, d, isBlockedClient, savedDraft) : ""}
              </div>
            </div>
          `
      }
    `;
  }

  renderSelectedDiscussionDetail(t, d, isBlockedClient, savedDraft = "") {
    const dg = t.diagnostics;
    const liveWait = dg.waitingSince ? formatLiveWaitingLabel(dg.waitingSince) : null;

    return `
      <!-- En-tête Diagnostic Détaillé -->
      <div class="disc-detail-header">
        <div class="disc-detail-client-meta">
          <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
            <h2>${escapeHtml(t.customerName)}</h2>
            ${t.customerEmail ? `<code>${escapeHtml(t.customerEmail)}</code>` : `<span class="text-subtle-sm">(E-mail non renseigné)</span>`}
            <span class="pm-pill-badge">${escapeHtml(t.topicLabel)}</span>
          </div>

          <div class="disc-diagnostic-badges" style="margin-top:0.45rem;">
            ${
              liveWait
                ? `<span class="diag-badge diag-wait-${dg.waitingLevel}" data-waiting-since="${escapeHtml(dg.waitingSince)}">⏳ ${escapeHtml(liveWait)}</span>`
                : `<span class="diag-badge diag-resolved">✓ Répondu / À jour</span>`
            }
            ${dg.needsFastHelp ? `<span class="diag-badge diag-fast-help">⚡ Nécessite de l'aide rapide</span>` : ""}
            ${dg.isAnnoyed ? `<span class="diag-badge diag-annoyed">😤 Client agacé</span>` : ""}
            ${dg.isSuspectedFraud ? `<span class="diag-badge diag-fraud">🚨 Suspecté de fraude (${dg.riskScore}/100)</span>` : ""}
            ${
              dg.linkedOrderIds?.length
                ? dg.linkedOrderIds
                    .map(
                      (oid) => `<button type="button" class="diag-badge diag-order-link" data-deliver-order="${escapeHtml(oid)}">📦 Ouvrir commande #${escapeHtml(oid)} →</button>`
                    )
                    .join("")
                : ""
            }
          </div>
        </div>

        <!-- Boutons de contrôle manuel des indicateurs & sécurité -->
        <div class="disc-manual-flags-bar">
          <button type="button" class="btn btn-outline btn-xs" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-key="status" data-flag-val="${dg.isResolved ? "open" : "resolved"}">
            ${dg.isResolved ? "↺ Rouvrir" : "✅ Marquer résolu"}
          </button>
          <button type="button" class="btn btn-outline btn-xs" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-key="fastHelp" data-flag-val="${!dg.needsFastHelp}">
            ${dg.needsFastHelp ? "Retirer Aide rapide" : "⚡ Aide rapide"}
          </button>
          <button type="button" class="btn btn-outline btn-xs" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-key="annoyed" data-flag-val="${!dg.isAnnoyed}">
            ${dg.isAnnoyed ? "Retirer Agacé" : "😤 Marquer agacé"}
          </button>
          <button type="button" class="btn btn-outline btn-xs danger-btn" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-key="fraud" data-flag-val="${!dg.isSuspectedFraud}">
            ${dg.isSuspectedFraud ? "Lever soupçon fraude" : "🚨 Suspecter fraude"}
          </button>
          <button type="button" class="btn btn-outline btn-xs danger-btn" data-block-client="${escapeHtml(t.threadId)}" data-block-val="${!isBlockedClient}">
            ${isBlockedClient ? "Débloquer client" : "🚫 Bloquer client"}
          </button>
          <button type="button" class="btn btn-outline btn-xs" data-delete-thread="${escapeHtml(t.threadId)}" title="Supprimer la discussion">🗑️</button>
        </div>
      </div>

      ${
        dg.isSuspectedFraud && dg.fraudReasons?.length
          ? `
            <div class="fraud-reasons-alert">
              <strong>🚨 Détails de l'alerte Anti-Fraude :</strong>
              <ul>
                ${dg.fraudReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
              </ul>
            </div>
          `
          : ""
      }

      <!-- Messages de la conversation -->
      <div class="admin-disc-messages-box" id="admin-disc-scroll">
        ${(t.messages || [])
          .map((m) => {
            const cls = m.sender === "admin" ? "msg-admin" : m.sender === "customer" ? "msg-customer" : "msg-system";
            const author =
              m.sender === "admin" ? "Vous (Admin)" : m.sender === "customer" ? t.customerName : "Système";
            const time = new Date(m.createdAt).toLocaleString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "short"
            });
            return `
              <div class="chat-bubble ${cls}">
                <div class="chat-bubble-meta">
                  <strong>${escapeHtml(author)}</strong>
                  <span>${time}</span>
                </div>
                ${m.text ? `<div class="chat-bubble-text">${escapeHtml(m.text)}</div>` : ""}
                ${
                  m.attachment
                    ? `<div style="margin-top:0.35rem;font-size:0.78rem;color:var(--accent-cyan-light);">Pièce jointe envoyée : <strong>${escapeHtml(m.attachment.title || m.attachment.code)}</strong></div>`
                    : ""
                }
              </div>
            `;
          })
          .join("")}
      </div>

      <!-- Réponses pré-rédigées en 1 clic + Envoi d'article ou code promo -->
      <div class="admin-quick-replies-row">
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Bonjour ! Oui, cet abonnement est actuellement en stock avec livraison immédiate ici-même et par e-mail dès validation.">
          ✓ En stock immédiat
        </button>
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Rassurez-vous, votre argent est 100% protégé ! Je vérifie votre transaction immédiatement et je vous envoie vos accès d'ici quelques instants.">
          🛡️ Rassurer &amp; vérifier paiement
        </button>
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Je suis vraiment désolé pour l'attente ! Je m'occupe personnellement de votre demande en priorité tout de suite.">
          🤝 Apaiser client agacé
        </button>
      </div>

      <form id="admin-disc-reply-form" class="admin-disc-composer" data-reply-thread="${escapeHtml(t.threadId)}">
        <div class="composer-attach-row">
          <select id="admin-attach-product" class="form-control form-control-sm">
            <option value="">+ Joindre une fiche article cliquable (optionnel)</option>
            ${d.products.map((p) => `<option value="${escapeHtml(p.id)}">📦 ${escapeHtml(p.title)} (${p.price} €)</option>`).join("")}
          </select>
          <select id="admin-attach-coupon" class="form-control form-control-sm">
            <option value="">+ Joindre un code promo (optionnel)</option>
            ${d.coupons.filter((c) => c.active).map((c) => `<option value="${escapeHtml(c.code)}">🏷️ ${escapeHtml(c.code)} (${escapeHtml(c.label)})</option>`).join("")}
          </select>
        </div>
        <div class="live-chat-input-row">
          <input
            type="text"
            id="admin-disc-reply-input"
            class="form-control"
            placeholder="Répondre en direct à ${escapeHtml(t.customerName)}..."
            value="${escapeHtml(savedDraft)}"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-primary">Envoyer</button>
        </div>
      </form>
    `;
  }

  // ==========================================================================
  // COMMANDES & LIVRAISON (AVEC ALERTES ANTI-FRAUDE INTÉGRÉES)
  // ==========================================================================
  renderOrdersTab(orders, stats) {
    const filtered = orders.filter((o) => {
      if (this.orderFilter === "to_deliver") {
        return (o.paymentStatus === "paid" || o.paymentStatus === "declaration_sent") && o.deliveryStatus !== "delivered";
      }
      if (this.orderFilter === "delivered") return o.deliveryStatus === "delivered";
      return true;
    });

    return `
      <div class="admin-kpi-row">
        <div class="kpi-box">
          <span class="kpi-val">${stats.totalRevenue} €</span>
          <span class="kpi-lbl">Chiffre d'affaires validé</span>
        </div>
        <div class="kpi-box highlight-kpi">
          <span class="kpi-val">${stats.pendingDeliveries}</span>
          <span class="kpi-lbl">Commandes à livrer</span>
        </div>
        <div class="kpi-box">
          <span class="kpi-val">${stats.totalOrders}</span>
          <span class="kpi-lbl">Total commandes</span>
        </div>
      </div>

      <div class="admin-filter-pills">
        <button type="button" class="filter-pill ${this.orderFilter === "all" ? "active" : ""}" data-ord-filter="all">Toutes (${orders.length})</button>
        <button type="button" class="filter-pill ${this.orderFilter === "to_deliver" ? "active" : ""}" data-ord-filter="to_deliver">À vérifier / livrer (${stats.pendingDeliveries})</button>
        <button type="button" class="filter-pill ${this.orderFilter === "delivered" ? "active" : ""}" data-ord-filter="delivered">Livrées</button>
      </div>

      ${
        filtered.length === 0
          ? `<div class="admin-empty-state"><p>Aucune commande dans cette vue.</p></div>`
          : `
            <div class="admin-orders-list">
              ${filtered
                .map((ord) => {
                  const isPaid = ord.paymentStatus === "paid";
                  const isDeclared = ord.paymentStatus === "declaration_sent";
                  const isDelivered = ord.deliveryStatus === "delivered";
                  const isFraudRisk = (ord.riskScore || 0) >= 40;

                  const payBadge = isPaid
                    ? `<span class="order-status-badge badge-paid">✓ Payé (${escapeHtml(ord.paymentMethod.toUpperCase())})</span>`
                    : isDeclared
                    ? `<span class="order-status-badge badge-waiting">⚡ Paiement déclaré (${escapeHtml(ord.paymentMethod.toUpperCase())})</span>`
                    : `<span class="order-status-badge">⏳ Attente paiement (${escapeHtml(ord.paymentMethod.toUpperCase())})</span>`;

                  return `
                    <div class="admin-order-card ${isPaid ? "confirmed" : "pending"} ${isFraudRisk ? "fraud-border" : ""}">
                      <div class="order-card-top">
                        <div>
                          <span class="order-badge-id">#${escapeHtml(ord.orderId)}</span>
                          <span class="order-date-text">${new Date(ord.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                          ${isFraudRisk ? `<span class="diag-badge diag-fraud">🚨 Suspecté de fraude (${ord.riskScore}/100)</span>` : ""}
                          ${payBadge}
                          <span class="order-status-badge ${isDelivered ? "badge-paid" : "badge-waiting"}">${isDelivered ? "📦 Livré" : "À envoyer"}</span>
                        </div>
                      </div>

                      <div class="order-client-row">
                        <div><strong>${escapeHtml(ord.customerName)}</strong> • <code>${escapeHtml(ord.email)}</code></div>
                        <div class="order-total-price">${ord.total} €</div>
                      </div>

                      <div class="order-items-inline">
                        ${ord.items.map((i) => `${i.quantity}× <strong>${escapeHtml(i.title)}</strong>`).join(" • ")}
                        ${ord.paymentMethod === "sepa_instant" ? ` • Réf SEPA : <code>${escapeHtml(ord.sepaRef)}</code>` : ""}
                      </div>

                      ${
                        isFraudRisk && ord.fraudReasons?.length
                          ? `<div class="fraud-reasons-alert" style="margin:0.25rem 0;"><strong>⚠️ Vigilance avant envoi des accès :</strong> ${ord.fraudReasons.map(escapeHtml).join(" • ")}</div>`
                          : ""
                      }

                      ${ord.notes ? `<div class="order-notes-box">Note client : ${escapeHtml(ord.notes)}</div>` : ""}

                      <div class="order-admin-actions">
                        <button type="button" class="btn btn-primary btn-xs" data-deliver-order="${escapeHtml(ord.orderId)}">
                          🚀 ${isDelivered ? "Voir / Renvoyer les accès & Chat" : "Envoyer les accès (Site / Mail)"}
                        </button>
                        ${
                          !isPaid
                            ? `<button type="button" class="btn btn-secondary btn-xs" data-confirm-pay="${escapeHtml(ord.orderId)}">✓ Confirmer réception fonds</button>`
                            : ""
                        }
                        <button type="button" class="btn btn-outline btn-xs danger-btn" data-delete-order="${escapeHtml(ord.orderId)}">Supprimer</button>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          `
      }
    `;
  }

  // ==========================================================================
  // CATALOGUE : PRIX & DISPONIBILITÉS EN 1 CLIC
  // ==========================================================================
  renderCatalogTab(products) {
    return `
      <div class="admin-section-intro">
        <div>
          <h2>Gestion instantanée des Prix &amp; Disponibilités</h2>
          <p>Modifiez vos tarifs ou coupez la disponibilité d'un article : le site se met à jour en direct chez tous les clients.</p>
        </div>
        <button type="button" class="btn btn-primary btn-xs" id="btn-toggle-new-product">+ Ajouter un abonnement</button>
      </div>

      <form id="admin-new-product-form" class="admin-create-product-box hidden">
        <h3>Créer une nouvelle offre</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nom de l'offre *</label>
            <input type="text" name="title" class="form-control" placeholder="Ex : Spotify Premium — 1 an" required />
          </div>
          <div class="form-group">
            <label class="form-label">Durée affichée *</label>
            <input type="text" name="duration" class="form-control" value="12 mois (365 jours)" required />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Votre Prix de vente (€) *</label>
            <input type="number" name="price" step="0.01" min="1" class="form-control" placeholder="89" required />
          </div>
          <div class="form-group">
            <label class="form-label">Prix officiel barré (€)</label>
            <input type="number" name="compareAtPrice" step="0.01" min="0" class="form-control" placeholder="133.44" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Phrase d'accroche</label>
            <input type="text" name="tagline" class="form-control" placeholder="Musique illimitée sans pub & hors-connexion" />
          </div>
          <div class="form-group">
            <label class="form-label">Disponibilité initiale</label>
            <select name="availability" class="form-control">
              <option value="in_stock">En stock (Disponible)</option>
              <option value="low_stock">Stock limité</option>
              <option value="out_of_stock">Rupture de stock</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-xs" style="align-self:flex-start;margin-top:0.5rem;">Créer l'offre sur le site</button>
      </form>

      <div class="admin-products-manager-list">
        ${products
          .map(
            (p) => `
            <form class="admin-product-edit-card" data-product-form="${escapeHtml(p.id)}">
              <div class="prod-edit-top">
                <div class="prod-edit-title-group">
                  <span class="prod-color-dot" style="background:${escapeHtml(p.accentColor || "#8b5cf6")}"></span>
                  <input type="text" name="title" class="form-control prod-inline-title" value="${escapeHtml(p.title)}" required />
                </div>
                <div class="prod-edit-toggles">
                  <label class="inline-check-pill">
                    <input type="checkbox" name="popular" ${p.popular ? "checked" : ""} />
                    <span>★ Best-Seller</span>
                  </label>
                  <label class="inline-check-pill">
                    <input type="checkbox" name="active" ${p.active !== false ? "checked" : ""} />
                    <span>Visible</span>
                  </label>
                </div>
              </div>

              <div class="prod-edit-grid">
                <div class="form-group">
                  <label class="form-label">Prix de vente (€)</label>
                  <input type="number" name="price" step="0.01" min="0.5" class="form-control" value="${p.price}" required />
                </div>

                <div class="form-group">
                  <label class="form-label">Prix barré officiel (€)</label>
                  <input type="number" name="compareAtPrice" step="0.01" min="0" class="form-control" value="${p.compareAtPrice ?? ""}" />
                </div>

                <div class="form-group">
                  <label class="form-label">Disponibilité</label>
                  <select name="availability" class="form-control">
                    <option value="in_stock" ${p.availability === "in_stock" ? "selected" : ""}>🟢 En stock</option>
                    <option value="low_stock" ${p.availability === "low_stock" ? "selected" : ""}>🟠 Stock limité</option>
                    <option value="out_of_stock" ${p.availability === "out_of_stock" ? "selected" : ""}>🔴 Rupture</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label">Qté stock (vide = illimité)</label>
                  <input type="number" name="stockCount" min="0" step="1" class="form-control" value="${p.stockCount ?? ""}" placeholder="Illimité" />
                </div>

                <div class="form-group">
                  <label class="form-label">Durée</label>
                  <input type="text" name="duration" class="form-control" value="${escapeHtml(p.duration || "12 mois")}" />
                </div>
              </div>

              <div class="prod-edit-bottom">
                <input type="text" name="tagline" class="form-control" value="${escapeHtml(p.tagline || "")}" />
                <div class="prod-edit-btns">
                  <button type="submit" class="btn btn-primary btn-xs">✓ Enregistrer</button>
                  <button type="button" class="btn btn-outline btn-xs danger-btn" data-delete-product="${escapeHtml(p.id)}">Supprimer</button>
                </div>
              </div>
            </form>
          `
          )
          .join("")}
      </div>
    `;
  }

  // ==========================================================================
  // TÉLÉPHONE, PAIEMENTS & SÉCURITÉ ADMIN
  // ==========================================================================
  renderIntegrationsTab(s, ntfyInfo, adminInfo, securityInfo) {
    return `
      <form id="admin-settings-master-form" class="admin-integrations-stack">
        <div class="integration-panel highlight-integration">
          <div class="integration-head">
            <span class="legal-tag">iOS &amp; Android • Gratuit</span>
            <h2>📲 Notifications instantanées sur votre téléphone</h2>
            <p>Installez l'application gratuite <strong>ntfy</strong> sur votre téléphone et scannez ce QR Code. Chaque commande, urgence paiement ou message client fait vibrer votre téléphone avec un lien direct d'ouverture !</p>
          </div>

          <div class="ntfy-setup-grid">
            ${
              ntfyInfo?.qrDataUrl
                ? `<div class="ntfy-qr-card"><img src="${ntfyInfo.qrDataUrl}" alt="QR Code ntfy" width="145" height="145" /><span>Scanner dans ntfy</span></div>`
                : ""
            }
            <div class="ntfy-fields-col">
              <label class="inline-check-pill">
                <input type="checkbox" id="cfg-ntfy-enabled" ${s.notifications.ntfyEnabled ? "checked" : ""} />
                <span>Activer les alertes téléphone</span>
              </label>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Sujet privé ntfy.sh</label>
                  <input type="text" id="cfg-ntfy-topic" class="form-control" value="${escapeHtml(s.notifications.ntfyTopic)}" />
                </div>
                <div class="form-group">
                  <label class="form-label">URL publique du site</label>
                  <input type="text" id="cfg-public-url" class="form-control" value="${escapeHtml(s.publicUrl || "")}" placeholder="https://mon-site.fr" />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Webhook Discord / Slack (facultatif)</label>
                <input type="url" id="cfg-webhook-url" class="form-control" value="${escapeHtml(s.notifications.webhookUrl || "")}" placeholder="https://discord.com/api/webhooks/..." />
              </div>
              <button type="button" class="btn btn-secondary btn-xs" style="align-self:flex-start;" id="btn-test-phone-push">
                📲 Envoyer une notification test sur mon téléphone
              </button>
            </div>
          </div>
        </div>

        <div class="integration-panel">
          <div class="integration-head-inline">
            <h2>💳 Stripe (Carte Bancaire, Apple Pay, Google Pay)</h2>
            <label class="inline-check-pill">
              <input type="checkbox" id="cfg-stripe-enabled" ${s.payments.stripe.enabled ? "checked" : ""} />
              <span>Activé</span>
            </label>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Clé publique (pk_live_...)</label>
              <input type="text" id="cfg-stripe-pk" class="form-control" value="${escapeHtml(s.payments.stripe.publishableKey || "")}" />
            </div>
            <div class="form-group">
              <label class="form-label">Clé secrète chiffrée AES-256 (sk_live_...)</label>
              <input type="password" id="cfg-stripe-sk" class="form-control" value="${escapeHtml(s.payments.stripe.secretKeyPreview || "")}" placeholder="Collez sk_live_..." />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Secret Webhook (/api/webhooks/stripe)</label>
              <input type="password" id="cfg-stripe-wh" class="form-control" placeholder="${s.payments.stripe.hasWebhookSecret ? "Déjà chiffré" : "whsec_..."}" />
            </div>
            <div class="form-group">
              <label class="form-label">OU Lien Payment Link Stripe</label>
              <input type="url" id="cfg-stripe-link" class="form-control" value="${escapeHtml(s.payments.stripe.paymentLinkFallback || "")}" />
            </div>
          </div>
        </div>

        <div class="integration-panel">
          <div class="integration-head-inline">
            <h2>🅿️ PayPal (PayPal.Me ou API REST v2)</h2>
            <label class="inline-check-pill">
              <input type="checkbox" id="cfg-paypal-enabled" ${s.payments.paypal.enabled ? "checked" : ""} />
              <span>Activé</span>
            </label>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Lien rapide PayPal.Me</label>
              <input type="text" id="cfg-paypal-me" class="form-control" value="${escapeHtml(s.payments.paypal.paypalMeUrl || "")}" placeholder="https://paypal.me/VotrePseudo" />
            </div>
            <div class="form-group">
              <label class="form-label">Mode API</label>
              <select id="cfg-paypal-mode" class="form-control">
                <option value="live" ${s.payments.paypal.mode === "live" ? "selected" : ""}>Live</option>
                <option value="sandbox" ${s.payments.paypal.mode === "sandbox" ? "selected" : ""}>Sandbox</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">PayPal Client ID</label>
              <input type="text" id="cfg-paypal-cid" class="form-control" value="${escapeHtml(s.payments.paypal.clientId || "")}" />
            </div>
            <div class="form-group">
              <label class="form-label">PayPal Secret (chiffré AES-256)</label>
              <input type="password" id="cfg-paypal-sec" class="form-control" value="${escapeHtml(s.payments.paypal.clientSecretPreview || "")}" />
            </div>
          </div>
        </div>

        <div class="integration-panel">
          <div class="integration-head-inline">
            <h2>⚡ Virement SEPA Instantané &amp; QR Code EPC</h2>
            <label class="inline-check-pill">
              <input type="checkbox" id="cfg-sepa-enabled" ${s.payments.sepa.enabled ? "checked" : ""} />
              <span>Activé</span>
            </label>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Titulaire</label>
              <input type="text" id="cfg-sepa-bene" class="form-control" value="${escapeHtml(s.payments.sepa.beneficiary)}" />
            </div>
            <div class="form-group">
              <label class="form-label">Banque</label>
              <input type="text" id="cfg-sepa-bank" class="form-control" value="${escapeHtml(s.payments.sepa.bank)}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">IBAN</label>
              <input type="text" id="cfg-sepa-iban" class="form-control" value="${escapeHtml(s.payments.sepa.iban)}" />
            </div>
            <div class="form-group">
              <label class="form-label">BIC</label>
              <input type="text" id="cfg-sepa-bic" class="form-control" value="${escapeHtml(s.payments.sepa.bic)}" />
            </div>
          </div>
        </div>

        <div class="integration-panel">
          <div class="integration-head-inline">
            <h2>🔐 E-mails SMTP &amp; Sécurité du Compte Admin</h2>
            <label class="inline-check-pill">
              <input type="checkbox" id="cfg-smtp-enabled" ${s.notifications.smtp.enabled ? "checked" : ""} />
              <span>Activer SMTP Gmail</span>
            </label>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Gmail d'envoi</label>
              <input type="email" id="cfg-smtp-user" class="form-control" value="${escapeHtml(s.notifications.smtp.user || "")}" />
            </div>
            <div class="form-group">
              <label class="form-label">Mot de passe d'application Gmail (16 caract.)</label>
              <input type="password" id="cfg-smtp-pass" class="form-control" placeholder="${s.notifications.smtp.hasPass ? "Déjà chiffré" : "xxxx xxxx xxxx xxxx"}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">E-mail de connexion Admin</label>
              <input type="email" id="cfg-admin-email" class="form-control" value="${escapeHtml(adminInfo.email)}" />
            </div>
            <div class="form-group">
              <label class="form-label">Changer le mot de passe Admin (recommandé)</label>
              <input type="password" id="cfg-admin-newpass" class="form-control" placeholder="Nouveau mot de passe fort" />
            </div>
          </div>
          <p style="font-size:0.78rem;color:var(--text-muted);">
            Clients bloqués par l'anti-fraude : <strong>${(securityInfo?.blockedEmails || []).length} e-mail(s)</strong> et <strong>${securityInfo?.blockedHashesCount || 0} empreinte(s) réseau</strong>.
          </p>
        </div>

        <button type="submit" class="btn btn-primary" style="align-self:flex-start;">
          ✓ Enregistrer toute la configuration
        </button>
      </form>
    `;
  }

  renderCouponsTab(coupons) {
    return `
      <form id="admin-coupon-create-form" class="admin-create-product-box" style="margin-bottom:1.5rem;">
        <h3>Créer un code promotionnel</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Code *</label>
            <input type="text" name="code" class="form-control" placeholder="Ex : VIP10" required />
          </div>
          <div class="form-group">
            <label class="form-label">Type</label>
            <select name="type" class="form-control">
              <option value="percent">Pourcentage (%)</option>
              <option value="fixed">Montant fixe (€)</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Valeur *</label>
            <input type="number" name="value" step="0.5" min="0.5" class="form-control" placeholder="10" required />
          </div>
          <div class="form-group">
            <label class="form-label">Minimum d'achat (€)</label>
            <input type="number" name="minAmount" min="0" value="0" class="form-control" />
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-xs" style="margin-top:0.5rem;align-self:flex-start;">+ Activer ce code promo</button>
      </form>

      <div class="admin-coupons-grid">
        ${coupons
          .map(
            (c) => `
            <div class="admin-coupon-card ${c.active ? "active" : "inactive"}">
              <div class="coupon-card-header">
                <code class="coupon-code-text">${escapeHtml(c.code)}</code>
                <span class="coupon-status-pill ${c.active ? "pill-active" : "pill-inactive"}">${c.active ? "Actif" : "Désactivé"}</span>
              </div>
              <p class="coupon-label-text">${escapeHtml(c.label)} • Utilisé ${c.usageCount || 0} fois</p>
              <div class="coupon-card-actions">
                <button type="button" class="btn btn-outline btn-xs" data-toggle-coupon="${escapeHtml(c.code)}">${c.active ? "Désactiver" : "Activer"}</button>
                <button type="button" class="btn btn-outline btn-xs danger-btn" data-delete-coupon="${escapeHtml(c.code)}">Supprimer</button>
              </div>
            </div>
          `
          )
          .join("")}
      </div>
    `;
  }

  bindActiveTabEvents(container) {
    // Scroll Discussion messages to bottom
    const discScroll = container.querySelector("#admin-disc-scroll");
    if (discScroll) discScroll.scrollTop = discScroll.scrollHeight;

    // Discussions Filter & Thread Selection
    container.querySelectorAll("[data-disc-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.discFilter = btn.getAttribute("data-disc-filter");
        this.render();
      });
    });

    container.querySelectorAll("[data-select-thread]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-select-thread");
        this.selectedThreadId = tid;
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/read`, {
          method: "POST",
          headers: this.authHeaders()
        }).catch(() => {});
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Manual Flags (Resolved, Fast Help, Annoyed, Fraud)
    container.querySelectorAll("[data-flag-thread]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-flag-thread");
        const key = btn.getAttribute("data-flag-key");
        const rawVal = btn.getAttribute("data-flag-val");
        const val = rawVal === "true" ? true : rawVal === "false" ? false : rawVal;

        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/flags`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify({ [key]: val })
        });
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Block / Unblock suspicious client
    container.querySelectorAll("[data-block-client]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-block-client");
        const shouldBlock = btn.getAttribute("data-block-val") === "true";
        if (shouldBlock && !confirm("Bloquer cet e-mail et cette connexion réseau contre toute nouvelle commande ?")) {
          return;
        }
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/flags`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify({ blockClient: shouldBlock })
        });
        showToast(shouldBlock ? "Client bloqué par l'anti-fraude." : "Client débloqué.", "info");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    container.querySelectorAll("[data-delete-thread]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-delete-thread");
        if (!confirm("Supprimer cette discussion ?")) return;
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}`, {
          method: "DELETE",
          headers: this.authHeaders()
        });
        this.selectedThreadId = null;
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Quick Pre-written Replies
    container.querySelectorAll("[data-admin-quick]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const inp = container.querySelector("#admin-disc-reply-input");
        if (inp) {
          inp.value = chip.getAttribute("data-admin-quick") || "";
          inp.focus();
        }
      });
    });

    // Reply in Admin Discussion
    container.querySelector("#admin-disc-reply-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const tid = form.getAttribute("data-reply-thread");
      const input = container.querySelector("#admin-disc-reply-input");
      const prodSel = container.querySelector("#admin-attach-product");
      const cpnSel = container.querySelector("#admin-attach-coupon");

      const text = input?.value.trim() || "";
      const attachedProductId = prodSel?.value || null;
      const attachedCouponCode = cpnSel?.value || null;
      if (!text && !attachedProductId && !attachedCouponCode) return;

      input.value = "";
      const resp = await fetch(`/api/discussions/${encodeURIComponent(tid)}/messages`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ text, attachedProductId, attachedCouponCode })
      });
      if (resp.ok) {
        await this.refreshDashboardSilently();
        this.render();
      } else {
        showToast("Erreur lors de l'envoi de la réponse.", "error");
      }
    });

    // Catalog events
    container.querySelector("#btn-toggle-new-product")?.addEventListener("click", () => {
      container.querySelector("#admin-new-product-form")?.classList.toggle("hidden");
    });

    container.querySelector("#admin-new-product-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const resp = await fetch("/api/admin/products", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(Object.fromEntries(fd.entries()))
      });
      if (resp.ok) {
        showToast("Nouvel abonnement ajouté au catalogue !", "success");
        await store.initBootstrap();
        await this.refreshDashboardSilently();
        this.render();
      }
    });

    container.querySelectorAll("[data-product-form]").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = form.getAttribute("data-product-form");
        const payload = {
          title: form.elements.title.value,
          price: Number(form.elements.price.value),
          compareAtPrice: form.elements.compareAtPrice.value === "" ? null : Number(form.elements.compareAtPrice.value),
          availability: form.elements.availability.value,
          stockCount: form.elements.stockCount.value === "" ? null : parseInt(form.elements.stockCount.value, 10),
          duration: form.elements.duration.value,
          tagline: form.elements.tagline.value,
          popular: form.elements.popular.checked,
          active: form.elements.active.checked
        };
        const resp = await fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: this.authHeaders(),
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          showToast("Prix et disponibilité mis à jour en direct !", "success");
          await store.initBootstrap();
          await this.refreshDashboardSilently();
          this.render();
        }
      });
    });

    container.querySelectorAll("[data-delete-product]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-delete-product");
        if (!confirm("Supprimer cette offre du catalogue ?")) return;
        await fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: this.authHeaders()
        });
        await store.initBootstrap();
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Orders events
    container.querySelectorAll("[data-ord-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.orderFilter = btn.getAttribute("data-ord-filter");
        this.render();
      });
    });

    container.querySelectorAll("[data-deliver-order]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.openDeliverOrderDialog(btn.getAttribute("data-deliver-order"));
      });
    });

    container.querySelectorAll("[data-confirm-pay]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-confirm-pay");
        await fetch(`/api/admin/orders/${encodeURIComponent(id)}/confirm-payment`, {
          method: "POST",
          headers: this.authHeaders()
        });
        showToast(`Paiement #${id} confirmé !`, "success");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    container.querySelectorAll("[data-delete-order]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-delete-order");
        if (!confirm(`Supprimer la commande #${id} ?`)) return;
        await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: this.authHeaders()
        });
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Phone Push Test & Settings
    container.querySelector("#btn-test-phone-push")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const resp = await fetch("/api/admin/test-notification", {
        method: "POST",
        headers: this.authHeaders()
      });
      const data = await resp.json();
      btn.disabled = false;
      if (data.pushRes?.ntfy || data.pushRes?.webhook) {
        showToast("Notification envoyée sur votre téléphone !", "success");
      } else {
        showToast(`Info : ${data.pushRes?.errors?.join(", ") || "Vérifiez votre connexion"}`, "info");
      }
    });

    container.querySelector("#admin-settings-master-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        publicUrl: container.querySelector("#cfg-public-url").value,
        payments: {
          stripe: {
            enabled: container.querySelector("#cfg-stripe-enabled").checked,
            publishableKey: container.querySelector("#cfg-stripe-pk").value,
            secretKey: container.querySelector("#cfg-stripe-sk").value,
            webhookSecret: container.querySelector("#cfg-stripe-wh").value,
            paymentLinkFallback: container.querySelector("#cfg-stripe-link").value
          },
          paypal: {
            enabled: container.querySelector("#cfg-paypal-enabled").checked,
            mode: container.querySelector("#cfg-paypal-mode").value,
            paypalMeUrl: container.querySelector("#cfg-paypal-me").value,
            clientId: container.querySelector("#cfg-paypal-cid").value,
            clientSecret: container.querySelector("#cfg-paypal-sec").value
          },
          sepa: {
            enabled: container.querySelector("#cfg-sepa-enabled").checked,
            beneficiary: container.querySelector("#cfg-sepa-bene").value,
            bank: container.querySelector("#cfg-sepa-bank").value,
            iban: container.querySelector("#cfg-sepa-iban").value,
            bic: container.querySelector("#cfg-sepa-bic").value
          }
        },
        notifications: {
          ntfyEnabled: container.querySelector("#cfg-ntfy-enabled").checked,
          ntfyTopic: container.querySelector("#cfg-ntfy-topic").value,
          webhookUrl: container.querySelector("#cfg-webhook-url").value,
          smtp: {
            enabled: container.querySelector("#cfg-smtp-enabled").checked,
            user: container.querySelector("#cfg-smtp-user").value,
            pass: container.querySelector("#cfg-smtp-pass").value
          }
        },
        adminAccount: {
          email: container.querySelector("#cfg-admin-email").value,
          newPassword: container.querySelector("#cfg-admin-newpass").value
        }
      };

      const resp = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: this.authHeaders(),
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        showToast("Configuration enregistrée et chiffrée !", "success");
        await store.initBootstrap();
        await this.refreshDashboardSilently();
        this.render();
      }
    });

    // Coupons
    container.querySelector("#admin-coupon-create-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const resp = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(Object.fromEntries(fd.entries()))
      });
      if (resp.ok) {
        showToast("Code promo activé !", "success");
        await this.refreshDashboardSilently();
        this.render();
      }
    });

    container.querySelectorAll("[data-toggle-coupon]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`/api/admin/coupons/${encodeURIComponent(btn.getAttribute("data-toggle-coupon"))}`, {
          method: "PATCH",
          headers: this.authHeaders()
        });
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    container.querySelectorAll("[data-delete-coupon]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`/api/admin/coupons/${encodeURIComponent(btn.getAttribute("data-delete-coupon"))}`, {
          method: "DELETE",
          headers: this.authHeaders()
        });
        await this.refreshDashboardSilently();
        this.render();
      });
    });
  }

  async openDeliverOrderDialog(orderId) {
    const dialog = document.getElementById("admin-deliver-dialog");
    const container = document.getElementById("admin-deliver-dialog-content");
    if (!dialog || !container) return;

    const resp = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      headers: this.authHeaders()
    });
    if (!resp.ok) {
      showToast("Commande introuvable.", "error");
      return;
    }
    const { order } = await resp.json();
    const existingCreds = order.deliveredAccess?.credentials || [];

    container.innerHTML = `
      <div class="admin-modal-header">
        <div>
          <span class="legal-tag">Livraison Chiffrée AES-256</span>
          <h1 id="admin-deliver-dialog-title" class="admin-title">Livrer #${escapeHtml(order.orderId)} — ${escapeHtml(order.customerName)}</h1>
          <p class="admin-subtitle">Destinataire : <code>${escapeHtml(order.email)}</code> • Montant : <strong>${order.total} €</strong></p>
        </div>
        <button type="button" class="btn-close-dialog" data-close-deliver aria-label="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="admin-deliver-grid">
        <form id="admin-deliver-access-form" class="deliver-form-col">
          <h2>1. Accès à remettre au client</h2>
          ${
            (order.riskScore || 0) >= 40
              ? `<div class="fraud-reasons-alert"><strong>🚨 Attention — Risque Fraude (${order.riskScore}/100) :</strong> Vérifiez bien que les fonds sont crédités sur votre compte avant d'envoyer ces identifiants ! (${(order.fraudReasons || []).map(escapeHtml).join(" • ")})</div>`
              : ""
          }
          ${order.notes ? `<div class="order-notes-box">📌 Précision client : <strong>${escapeHtml(order.notes)}</strong></div>` : ""}

          ${order.items
            .map((item, idx) => {
              const prev = existingCreds[idx] || {};
              return `
                <div class="deliver-cred-fieldset">
                  <h3>📦 ${escapeHtml(item.title)} (Qté : ${item.quantity})</h3>
                  <div class="form-group">
                    <label class="form-label">Lien d'invitation / d'activation</label>
                    <input type="text" name="inviteLink_${idx}" class="form-control" value="${escapeHtml(prev.inviteLink || "")}" placeholder="https://families.google.com/join/..." />
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Identifiant / E-mail</label>
                      <input type="text" name="login_${idx}" class="form-control" value="${escapeHtml(prev.login || "")}" />
                    </div>
                    <div class="form-group">
                      <label class="form-label">Mot de passe</label>
                      <input type="text" name="password_${idx}" class="form-control" value="${escapeHtml(prev.password || "")}" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Profil attribué</label>
                      <input type="text" name="profile_${idx}" class="form-control" value="${escapeHtml(prev.profile || "")}" placeholder="Ex : Profil n°2" />
                    </div>
                    <div class="form-group">
                      <label class="form-label">Code PIN</label>
                      <input type="text" name="pin_${idx}" class="form-control" value="${escapeHtml(prev.pin || "")}" placeholder="Ex : 4829" />
                    </div>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Consignes spécifiques</label>
                    <textarea name="instructions_${idx}" class="form-control" rows="2">${escapeHtml(prev.instructions || "")}</textarea>
                  </div>
                </div>
              `;
            })
            .join("")}

          <div class="form-group">
            <label class="form-label">Note personnelle (facultatif)</label>
            <textarea id="deliver-custom-msg" class="form-control" rows="2" placeholder="Merci pour votre confiance !">${escapeHtml(order.deliveredAccess?.customMessage || "")}</textarea>
          </div>

          <div class="deliver-channels-box">
            <label class="inline-check-pill">
              <input type="checkbox" id="deliver-via-dialog" checked />
              <span>⚡ Afficher immédiatement dans le coffre du client sur le site</span>
            </label>
            <label class="inline-check-pill">
              <input type="checkbox" id="deliver-via-email" checked />
              <span>✉️ Envoyer par e-mail à ${escapeHtml(order.email)}</span>
            </label>
          </div>

          <div id="deliver-mailto-fallback" class="hidden"></div>

          <button type="submit" class="btn btn-primary" style="width:100%;">
            🚀 Valider &amp; Envoyer les accès maintenant
          </button>
        </form>

        <div class="deliver-chat-col">
          <h2>2. Discussion sur la commande</h2>
          <div class="live-chat-messages" id="admin-order-chat-scroll">
            ${(order.messages || [])
              .map(
                (m) => `
                <div class="chat-bubble ${m.sender === "admin" ? "msg-admin" : m.sender === "customer" ? "msg-customer" : "msg-system"}">
                  <div class="chat-bubble-meta">
                    <strong>${m.sender === "admin" ? "Vous (Admin)" : m.sender === "customer" ? escapeHtml(order.customerName) : "Système"}</strong>
                    <span>${new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div class="chat-bubble-text">${escapeHtml(m.text)}</div>
                </div>
              `
              )
              .join("")}
          </div>
          <form id="admin-order-chat-form" class="live-chat-input-row">
            <input type="text" id="admin-order-chat-input" class="form-control" placeholder="Écrire au client..." autocomplete="off" />
            <button type="submit" class="btn btn-secondary">Envoyer</button>
          </form>
        </div>
      </div>
    `;

    const chatScroll = container.querySelector("#admin-order-chat-scroll");
    if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;

    container.querySelector("[data-close-deliver]")?.addEventListener("click", () => closeDialogSmoothly(dialog));

    container.querySelector("#admin-deliver-access-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const credentials = order.items.map((item, idx) => ({
        productTitle: `${item.title} (${item.quantity}x)`,
        inviteLink: form.elements[`inviteLink_${idx}`]?.value.trim() || "",
        login: form.elements[`login_${idx}`]?.value.trim() || "",
        password: form.elements[`password_${idx}`]?.value.trim() || "",
        profile: form.elements[`profile_${idx}`]?.value.trim() || "",
        pin: form.elements[`pin_${idx}`]?.value.trim() || "",
        instructions: form.elements[`instructions_${idx}`]?.value.trim() || ""
      }));

      const sendViaDialog = container.querySelector("#deliver-via-dialog").checked;
      const sendViaEmail = container.querySelector("#deliver-via-email").checked;
      const customMessage = container.querySelector("#deliver-custom-msg").value;

      const r = await fetch(`/api/admin/orders/${encodeURIComponent(order.orderId)}/deliver`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ credentials, customMessage, sendViaDialog, sendViaEmail, markPaid: true })
      });
      const resData = await r.json();

      if (r.ok) {
        await this.refreshDashboardSilently();
        this.render();
        if (sendViaEmail && !resData.emailSent && resData.mailtoUrl) {
          showToast("Accès livrés en direct sur le site ! Utilisez le bouton Mail rapide ci-dessous.", "success", 6000);
          const fbBox = container.querySelector("#deliver-mailto-fallback");
          if (fbBox) {
            fbBox.classList.remove("hidden");
            fbBox.innerHTML = `
              <div class="declared-alert-box" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
                <span>✓ Accès envoyés sur le site !</span>
                <a href="${resData.mailtoUrl}" class="btn btn-secondary btn-xs">✉️ Ouvrir l'e-mail pré-rempli</a>
              </div>
            `;
          }
        } else {
          showToast("🎉 Accès chiffrés livrés au client sur le site et par e-mail !", "success", 5000);
          closeDialogSmoothly(dialog);
        }
      }
    });

    container.querySelector("#admin-order-chat-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = container.querySelector("#admin-order-chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      const r = await fetch(`/api/orders/${encodeURIComponent(order.orderId)}/messages`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ text })
      });
      if (r.ok) this.openDeliverOrderDialog(order.orderId);
    });

    if (!dialog.open) dialog.showModal();
  }
}

export const admin = new AdminController();
