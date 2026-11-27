/**
 * Espace Administrateur Complet (v4) :
 * - Système avancé de Flags Précis (25 flags structurés en 4 catégories : Sécurité/Fraude, Émotion/Ton,
 *   Urgence/Opérations, Commercial/Confiance) avec gestion Auto / Forcé Manuel / Ignoré + Notes privées
 * - Visualisation complète de l'Algorithme Anti-Fraude en 6 Dimensions + Suivi Comportemental du Parcours Site
 * - Nouvel Onglet "👤 Clients & Anti-Fraude" (Comptes inscrits, Visiteurs suivis en direct, Suspension, Whitelist, Blocage)
 * - Discussions Split-View, Commandes & Livraison chiffrée, Catalogue temps réel, Téléphone ntfy & Paiements
 */

import { store } from "./store.js";
import { closeDialogSmoothly, showToast, playChime, escapeHtml } from "./mwg-helpers.js";

const ADMIN_TOKEN_KEY = "nexus_admin_jwt_v2";

const FLAG_CATEGORY_LABELS = {
  fraud: "🚨 Sécurité & Risque de Fraude",
  emotion: "🎭 État Émotionnel & Ton",
  urgency: "⚡ Urgence & Opérations",
  commercial: "⭐ Profil Commercial & Confiance"
};

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

function formatDurationSec(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getRiskMeterClass(score) {
  const s = Number(score || 0);
  if (s >= 70) return "risk-critical";
  if (s >= 45) return "risk-elevated";
  if (s >= 25) return "risk-moderate";
  return "risk-low";
}

function getRiskLevelLabel(score) {
  const s = Number(score || 0);
  if (s >= 70) return "Critique";
  if (s >= 45) return "Élevé";
  if (s >= 25) return "Modéré";
  return "Faible";
}

/**
 * Rend le panneau détaillé d'analyse Anti-Fraude en 6 dimensions + suivi complet sur le site
 */
function renderFraudAnalyticsPanel(assessment, { openByDefault = false, compactTitle = "🔬 Analyse Anti-Fraude (6 Dimensions) & Parcours Complet sur le Site" } = {}) {
  if (!assessment) return "";
  const dims = assessment.dimensions || {};
  const journey = assessment.siteJourneySummary;
  const signals = Array.isArray(assessment.signals) ? assessment.signals : [];
  const score = Number(assessment.score || 0);
  const confidence = Number(assessment.confidence || 0);
  const meterCls = getRiskMeterClass(score);

  const dimRows = [
    { label: "Identité & E-mail", val: Number(dims.identity || 0), max: 100 },
    { label: "Comportement Site", val: Number(dims.behavioral || 0), max: 100 },
    { label: "Vélocité & Multi-Comptes", val: Number(dims.velocityGraph || 0), max: 100 },
    { label: "Paiement & Transactions", val: Number(dims.payment || 0), max: 100 },
    { label: "Linguistique & Social Eng.", val: Number(dims.linguistic || 0), max: 100 }
  ];
  const trustBonus = Number(dims.trustBonus || 0);

  return `
    <details class="admin-fraud-details ${meterCls}" ${openByDefault ? "open" : ""}>
      <summary class="admin-fraud-summary">
        <span>${compactTitle}</span>
        <span class="fraud-score-pill ${meterCls}">
          Score : <strong>${score}/100</strong> (${getRiskLevelLabel(score)}) • Confiance ${confidence}%
        </span>
      </summary>

      <div class="admin-fraud-panel-body">
        <div class="fraud-reco-banner ${meterCls}">
          <strong>Action recommandée :</strong> ${escapeHtml(assessment.recommendationLabel || "")}
        </div>

        <!-- 6 Dimensions Visuelles -->
        <div class="fraud-dims-grid">
          ${dimRows
            .map(
              (d) => `
              <div class="fraud-dim-row">
                <div class="fraud-dim-meta">
                  <span>${d.label}</span>
                  <strong>${d.val}/100</strong>
                </div>
                <div class="fraud-dim-track">
                  <div class="fraud-dim-fill ${getRiskMeterClass(d.val)}" style="width:${Math.min(100, d.val)}%"></div>
                </div>
              </div>
            `
            )
            .join("")}
          <div class="fraud-dim-row">
            <div class="fraud-dim-meta">
              <span>🛡️ Modificateur Confiance</span>
              <strong class="trust-bonus-val">${trustBonus < 0 ? `${trustBonus} pts` : "0 pt"}</strong>
            </div>
            <div class="fraud-dim-track">
              <div class="fraud-dim-fill risk-low" style="width:${Math.min(100, Math.abs(trustBonus) * 2.5)}%"></div>
            </div>
          </div>
        </div>

        <!-- Signaux précis détectés -->
        ${
          signals.length > 0
            ? `
            <div class="fraud-signals-block">
              <h3>Signaux détectés (${signals.length})</h3>
              <ul class="fraud-signals-list">
                ${signals
                  .map(
                    (s) => `
                    <li class="fraud-signal-item sev-${escapeHtml(s.severity || "medium")}">
                      <span class="signal-weight-tag ${s.weight < 0 ? "positive" : ""}">${s.weight > 0 ? `+${s.weight}` : s.weight}</span>
                      <div>
                        <strong>${escapeHtml(s.label)}</strong>
                        <span>${escapeHtml(s.detail)}</span>
                      </div>
                    </li>
                  `
                  )
                  .join("")}
              </ul>
            </div>
          `
            : `<p class="text-subtle-sm">Aucun signal d'anomalie détecté sur les 6 dimensions.</p>`
        }

        <!-- Suivi comportemental complet sur le site -->
        ${
          journey
            ? `
            <div class="site-journey-block">
              <h3>🧭 Suivi Comportemental sur le Site</h3>
              <div class="journey-kpis-grid">
                <div class="journey-kpi"><span>Temps site</span><strong>${formatDurationSec(journey.totalDurationSec)}</strong></div>
                <div class="journey-kpi"><span>Scroll max</span><strong>${journey.maxScrollDepthPct}%</strong></div>
                <div class="journey-kpi"><span>Sessions</span><strong>${journey.sessionCount}</strong></div>
                <div class="journey-kpi"><span>Interactions</span><strong>${journey.pointerMoves} mvt • ${journey.clickCount} clics</strong></div>
                <div class="journey-kpi ${journey.couponFailures >= 3 ? "kpi-warn" : ""}"><span>Promos ratés</span><strong>${journey.couponFailures}</strong></div>
                <div class="journey-kpi ${journey.orderLookupFailures >= 2 ? "kpi-warn" : ""}"><span>Lookups ratés</span><strong>${journey.orderLookupFailures}</strong></div>
                <div class="journey-kpi ${journey.loginFailures >= 2 ? "kpi-warn" : ""}"><span>Logins ratés</span><strong>${journey.loginFailures}</strong></div>
                <div class="journey-kpi ${journey.paymentMethodSwitches >= 3 ? "kpi-warn" : ""}"><span>Switch paiement</span><strong>${journey.paymentMethodSwitches}</strong></div>
              </div>

              <div class="journey-meta-tags">
                ${journey.userAgentSummary ? `<span class="meta-mini-chip">💻 ${escapeHtml(journey.userAgentSummary)}</span>` : ""}
                ${journey.timezone ? `<span class="meta-mini-chip">🌍 ${escapeHtml(journey.timezone)} (${escapeHtml(journey.language || "?")})</span>` : ""}
                ${journey.screenSize ? `<span class="meta-mini-chip">🖥️ ${escapeHtml(journey.screenSize)}</span>` : ""}
                ${journey.linkedUsersCount > 1 ? `<span class="meta-mini-chip warn">👥 ${journey.linkedUsersCount} comptes sur cette empreinte</span>` : ""}
                ${journey.webdriverDetected ? `<span class="meta-mini-chip danger">🤖 WebDriver détecté</span>` : ""}
                ${journey.viewedProducts?.length ? `<span class="meta-mini-chip">📦 Vus : ${journey.viewedProducts.map(escapeHtml).join(", ")}</span>` : ""}
                ${journey.sectionsVisited?.length ? `<span class="meta-mini-chip">📍 Sections : ${journey.sectionsVisited.map(escapeHtml).join(", ")}</span>` : ""}
              </div>

              ${
                journey.recentEvents?.length
                  ? `
                  <div class="journey-timeline">
                    <strong>Dernières actions sur le site :</strong>
                    <ul>
                      ${journey.recentEvents
                        .slice(0, 8)
                        .map(
                          (ev) => `
                          <li>
                            <span class="tl-time">${new Date(ev.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                            <code class="tl-type">${escapeHtml(ev.type)}</code>
                            <span class="tl-label">${escapeHtml(ev.label || "")}${ev.ok === false ? " ❌" : ev.ok === true ? " ✓" : ""}</span>
                          </li>
                        `
                        )
                        .join("")}
                    </ul>
                  </div>
                `
                  : ""
              }
            </div>
          `
            : `<p class="text-subtle-sm">En attente de données de suivi comportemental pour cette session.</p>`
        }
      </div>
    </details>
  `;
}

const DOSSIER_STATUS_META = {
  normal: { label: "Normal", cls: "st-normal" },
  lost_goods: { label: "🆘 Bien perdu", cls: "st-lost_goods" },
  investigating: { label: "🔎 Enquête", cls: "st-investigating" },
  recovered: { label: "✅ Retrouvé", cls: "st-recovered" },
  disputed: { label: "⚠️ Litige", cls: "st-disputed" }
};

function formatRelayCountdownLabel(relayDueAt) {
  if (!relayDueAt) return "";
  const rem = Math.max(0, Math.ceil((new Date(relayDueAt).getTime() - Date.now()) / 1000));
  if (rem <= 0) return "Relais IA imminent…";
  return `Relais IA dans ${rem}s`;
}

function getRelayStatusMeta(aiControl) {
  if (!aiControl) return { mode: "human_active", label: "👤 Humain", cls: "is-human" };
  if (aiControl.mode === "waiting_human") {
    return {
      mode: "waiting_human",
      label: formatRelayCountdownLabel(aiControl.relayDueAt),
      cls: "is-waiting",
      relayDueAt: aiControl.relayDueAt
    };
  }
  if (aiControl.mode === "ai_active") {
    return { mode: "ai_active", label: "🤖 IA active", cls: "is-ai" };
  }
  return { mode: "human_active", label: "👤 Humain actif", cls: "is-human" };
}

function renderAdminChatBubble(m, customerName = "Client") {
  const relayCls =
    m.sender === "relay"
      ? m.relayEvent === "human_takeover"
        ? "msg-relay relay-human"
        : m.relayEvent === "ai_takeover" || m.relayEvent === "ai_resume"
        ? "msg-relay relay-ai"
        : "msg-relay relay-waiting"
      : "";
  const cls =
    m.sender === "admin"
      ? "msg-admin"
      : m.sender === "ai"
      ? "msg-ai"
      : m.sender === "relay"
      ? relayCls
      : m.sender === "customer"
      ? "msg-customer"
      : "msg-system";
  const author =
    m.sender === "admin"
      ? "Vous (Admin)"
      : m.sender === "ai"
      ? `🤖 Assistant IA (${m.aiModel || "Gemini"})`
      : m.sender === "relay"
      ? m.relayEvent === "human_takeover"
        ? "👤 REPRISE HUMAINE"
        : m.relayEvent === "ai_takeover" || m.relayEvent === "ai_resume"
        ? "🤖 RELAIS IA ACTIVÉ"
        : "📩 ASSISTANCE HUMAINE DEMANDÉE"
      : m.sender === "customer"
      ? customerName
      : "Système";
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
}

class AdminController {
  constructor() {
    this.token = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
    this.dashboard = null;
    this.activeTab = "discussions"; // 'discussions' | 'dossiers' | 'orders' | 'customers' | 'catalog' | 'integrations' | 'coupons'
    this.orderFilter = "all";
    this.discFilter = "all";
    this.dossierFilter = "all";
    this.dossierSearch = "";
    this.selectedDossierId = null;
    this.mobileDossierDetailOpen = false;
    this.adminRevealDossierSecrets = false;
    this.customerFilter = "all"; // 'all' | 'high_risk' | 'vip' | 'suspended' | 'visitors'
    this.customerSearch = "";
    this.selectedThreadId = null;
    this.mobileDetailOpen = false;
    this.adminSse = null;
    this.pendingDeepLinkOrderId = null;
    this.pendingDeepLinkThreadId = null;
    this.liveTimerInterval = null;
  }

  init() {
    if (this.token) {
      this.refreshDashboardSilently();
    }
    this.liveTimerInterval = setInterval(() => {
      const dialog = document.getElementById("admin-dialog");
      if (dialog?.open && this.activeTab === "discussions" && this.dashboard) {
        document.querySelectorAll("[data-waiting-since]").forEach((el) => {
          const iso = el.getAttribute("data-waiting-since");
          if (iso) el.textContent = `⏳ ${formatLiveWaitingLabel(iso)}`;
        });
        document.querySelectorAll("[data-relay-countdown]").forEach((el) => {
          const due = el.getAttribute("data-relay-countdown");
          if (due) el.textContent = formatRelayCountdownLabel(due);
        });
      }
    }, 1000);

    // Synchronisation légère toutes les 5s quand la modale Admin est ouverte sur Discussions (résiste aux coupures SSE Render)
    setInterval(async () => {
      const dialog = document.getElementById("admin-dialog");
      if (!dialog?.open || !this.token || this.activeTab !== "discussions" || !this.dashboard) return;
      const prevSig = (this.dashboard.discussions || [])
        .map((t) => `${t.threadId}:${t.messages?.length || 0}:${t.aiControl?.mode || ""}`)
        .join("|");
      const ok = await this.refreshDashboardSilently();
      if (!ok) return;
      const nextSig = (this.dashboard.discussions || [])
        .map((t) => `${t.threadId}:${t.messages?.length || 0}:${t.aiControl?.mode || ""}`)
        .join("|");
      if (nextSig !== prevSig) {
        this.render({ preserveChatDraft: true });
      }
    }, 5000);
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
      es.addEventListener("customer_updated", () => onEvent("customer_updated"));
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
      this.mobileDetailOpen = true;
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
              <label for="admin-login-email" class="form-label">Identifiant administrateur *</label>
              <input
                type="text"
                id="admin-login-email"
                class="form-control"
                value=""
                placeholder="Saisissez votre identifiant"
                autocomplete="username"
                spellcheck="false"
                autofocus
                required
              />
            </div>

            <div class="form-group">
              <label for="admin-login-pass" class="form-label">Mot de passe secret *</label>
              <input
                type="password"
                id="admin-login-pass"
                class="form-control"
                value=""
                placeholder="Saisissez votre mot de passe"
                autocomplete="current-password"
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
              Comptes : <strong>${d.stats.totalCustomers || 0}</strong> •
              Alertes Fraude : <strong>${(d.stats.fraudDiscussionsCount || 0) + (d.stats.highRiskCustomers || 0)}</strong>
            </p>
          </div>
        </div>
        <div class="admin-header-actions">
          <button type="button" class="btn btn-outline btn-xs" id="btn-admin-refresh" aria-label="Actualiser les données" title="Actualiser">↻</button>
          <button type="button" class="btn btn-outline btn-xs" id="btn-admin-logout">Déconnexion</button>
          <button type="button" class="btn-close-dialog" data-close-admin aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div class="admin-tabs-nav mwg-tablist-scroller" role="tablist" aria-label="Sections Administration">
        <button type="button" role="tab" aria-selected="${this.activeTab === "discussions"}" class="admin-tab-btn ${this.activeTab === "discussions" ? "active" : ""}" data-admin-tab="discussions">
          <span>💬 Discussions &amp; Flags</span>
          ${
            (d.stats.urgentDiscussionsCount || 0) > 0
              ? `<span class="tab-badge-count">${d.stats.urgentDiscussionsCount} urg.</span>`
              : `<span class="tab-badge-count muted">${d.discussions.length}</span>`
          }
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "dossiers"}" class="admin-tab-btn ${this.activeTab === "dossiers" ? "active" : ""}" data-admin-tab="dossiers">
          <span>📁 Dossiers</span>
          ${
            (d.stats.lostGoodsCount || 0) + (d.stats.orphanClaimsCount || 0) > 0
              ? `<span class="tab-badge-count">${(d.stats.lostGoodsCount || 0) + (d.stats.orphanClaimsCount || 0)} alerte</span>`
              : `<span class="tab-badge-count muted">${d.stats.totalDossiers ?? d.orders.length}</span>`
          }
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "orders"}" class="admin-tab-btn ${this.activeTab === "orders" ? "active" : ""}" data-admin-tab="orders">
          <span>⚡ Commandes &amp; Livraison</span>
          ${d.stats.pendingDeliveries > 0 ? `<span class="tab-badge-count">${d.stats.pendingDeliveries}</span>` : `<span class="tab-badge-count muted">${d.orders.length}</span>`}
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "customers"}" class="admin-tab-btn ${this.activeTab === "customers" ? "active" : ""}" data-admin-tab="customers">
          <span>👤 Clients &amp; Anti-Fraude</span>
          ${
            (d.stats.highRiskCustomers || 0) > 0
              ? `<span class="tab-badge-count">${d.stats.highRiskCustomers} risque</span>`
              : `<span class="tab-badge-count muted">${d.stats.totalCustomers || 0}</span>`
          }
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "catalog"}" class="admin-tab-btn ${this.activeTab === "catalog" ? "active" : ""}" data-admin-tab="catalog">
          <span>📦 Catalogue (${d.products.length})</span>
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "integrations"}" class="admin-tab-btn ${this.activeTab === "integrations" ? "active" : ""}" data-admin-tab="integrations">
          <span>📲 Téléphone, IA &amp; Paiements</span>
        </button>

        <button type="button" role="tab" aria-selected="${this.activeTab === "coupons"}" class="admin-tab-btn ${this.activeTab === "coupons" ? "active" : ""}" data-admin-tab="coupons">
          <span>🏷️ Promos (${d.coupons.length})</span>
        </button>
      </div>

      <div class="admin-dashboard-body">
        ${this.renderTabBody(d, savedDraft)}
      </div>

      <!-- Barre de navigation inférieure dédiée au pouce sur mobile -->
      <nav class="admin-mobile-bottom-nav" aria-label="Navigation rapide administration">
        <button type="button" class="admin-bnav-btn ${this.activeTab === "discussions" ? "active" : ""}" data-admin-tab="discussions" aria-current="${this.activeTab === "discussions" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">💬</span>
          <span class="bnav-lbl">Chats</span>
          ${(d.stats.urgentDiscussionsCount || 0) > 0 ? `<span class="bnav-badge">${d.stats.urgentDiscussionsCount}</span>` : ""}
        </button>
        <button type="button" class="admin-bnav-btn ${this.activeTab === "dossiers" ? "active" : ""}" data-admin-tab="dossiers" aria-current="${this.activeTab === "dossiers" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">📁</span>
          <span class="bnav-lbl">Dossiers</span>
          ${(d.stats.lostGoodsCount || 0) + (d.stats.orphanClaimsCount || 0) > 0 ? `<span class="bnav-badge">${(d.stats.lostGoodsCount || 0) + (d.stats.orphanClaimsCount || 0)}</span>` : ""}
        </button>
        <button type="button" class="admin-bnav-btn ${this.activeTab === "orders" ? "active" : ""}" data-admin-tab="orders" aria-current="${this.activeTab === "orders" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">⚡</span>
          <span class="bnav-lbl">Cmd</span>
          ${d.stats.pendingDeliveries > 0 ? `<span class="bnav-badge">${d.stats.pendingDeliveries}</span>` : ""}
        </button>
        <button type="button" class="admin-bnav-btn ${this.activeTab === "customers" ? "active" : ""}" data-admin-tab="customers" aria-current="${this.activeTab === "customers" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">👤</span>
          <span class="bnav-lbl">Clients</span>
          ${(d.stats.highRiskCustomers || 0) > 0 ? `<span class="bnav-badge">${d.stats.highRiskCustomers}</span>` : ""}
        </button>
        <button type="button" class="admin-bnav-btn ${this.activeTab === "catalog" ? "active" : ""}" data-admin-tab="catalog" aria-current="${this.activeTab === "catalog" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">📦</span>
          <span class="bnav-lbl">Offres</span>
        </button>
        <button type="button" class="admin-bnav-btn ${this.activeTab === "coupons" ? "active" : ""}" data-admin-tab="coupons" aria-current="${this.activeTab === "coupons" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">🏷️</span>
          <span class="bnav-lbl">Promos</span>
        </button>
        <button type="button" class="admin-bnav-btn ${this.activeTab === "integrations" ? "active" : ""}" data-admin-tab="integrations" aria-current="${this.activeTab === "integrations" ? "page" : "false"}">
          <span class="bnav-ico" aria-hidden="true">📲</span>
          <span class="bnav-lbl">Config</span>
        </button>
      </nav>
    `;

    container.querySelector("[data-close-admin]")?.addEventListener("click", () => closeDialogSmoothly(dialog));
    container.querySelector("#btn-admin-logout")?.addEventListener("click", () => this.logout());
    container.querySelector("#btn-admin-refresh")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      await this.refreshDashboardSilently();
      showToast("Tableau de bord actualisé.", "info", 1800);
      this.render({ preserveChatDraft: true });
    });

    container.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextTab = btn.getAttribute("data-admin-tab");
        if (nextTab === "discussions" && this.activeTab === "discussions" && this.mobileDetailOpen) {
          this.mobileDetailOpen = false;
        }
        this.activeTab = nextTab;
        this.render();
      });
    });

    this.bindActiveTabEvents(container);
  }

  renderTabBody(d, savedDraft = "") {
    if (this.activeTab === "discussions") return this.renderDiscussionsMenu(d, savedDraft);
    if (this.activeTab === "dossiers") return this.renderDossiersTab(d);
    if (this.activeTab === "orders") return this.renderOrdersTab(d.orders, d.stats);
    if (this.activeTab === "customers") return this.renderCustomersAntiFraudTab(d);
    if (this.activeTab === "catalog") return this.renderCatalogTab(d.products);
    if (this.activeTab === "integrations") return this.renderIntegrationsTab(d.settings, d.ntfyInfo, d.admin, d.security);
    return this.renderCouponsTab(d.coupons);
  }

  // ==========================================================================
  // MENU "DISCUSSIONS" : FLAGS PRÉCIS + ANALYSE ANTI-FRAUDE 6D + PARCOURS SITE
  // ==========================================================================
  renderDiscussionsMenu(d, savedDraft = "") {
    const threads = d.discussions || [];

    const hasFlag = (t, id) => (t.diagnostics?.flagIds || []).includes(id);
    const countFast = threads.filter((t) => !t.diagnostics.isResolved && t.diagnostics.needsFastHelp).length;
    const countWaiting = threads.filter((t) => !t.diagnostics.isResolved && t.diagnostics.waitingSince).length;
    const countFurious = threads.filter((t) => !t.diagnostics.isResolved && hasFlag(t, "furious_escalation")).length;
    const countAnnoyed = threads.filter((t) => !t.diagnostics.isResolved && hasFlag(t, "annoyed")).length;
    const countAnxious = threads.filter((t) => !t.diagnostics.isResolved && hasFlag(t, "anxious_worried")).length;
    const countFraud = threads.filter((t) => t.diagnostics.isSuspectedFraud).length;
    const countPressure = threads.filter((t) => hasFlag(t, "chargeback_threat") || hasFlag(t, "social_engineering")).length;
    const countReady = threads.filter((t) => !t.diagnostics.isResolved && hasFlag(t, "ready_to_buy")).length;
    const countVip = threads.filter((t) => hasFlag(t, "vip_loyal")).length;
    const countAi = threads.filter((t) => !t.diagnostics.isResolved && t.aiControl?.mode === "ai_active").length;
    const countResolved = threads.filter((t) => t.diagnostics.isResolved).length;

    const filtered = threads.filter((t) => {
      const dg = t.diagnostics;
      if (this.discFilter === "fast_help") return !dg.isResolved && dg.needsFastHelp;
      if (this.discFilter === "waiting") return !dg.isResolved && Boolean(dg.waitingSince);
      if (this.discFilter === "ai_active") return !dg.isResolved && t.aiControl?.mode === "ai_active";
      if (this.discFilter === "furious") return !dg.isResolved && hasFlag(t, "furious_escalation");
      if (this.discFilter === "annoyed") return !dg.isResolved && hasFlag(t, "annoyed");
      if (this.discFilter === "anxious") return !dg.isResolved && hasFlag(t, "anxious_worried");
      if (this.discFilter === "fraud") return dg.isSuspectedFraud;
      if (this.discFilter === "pressure") return hasFlag(t, "chargeback_threat") || hasFlag(t, "social_engineering");
      if (this.discFilter === "ready") return !dg.isResolved && hasFlag(t, "ready_to_buy");
      if (this.discFilter === "vip") return hasFlag(t, "vip_loyal");
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
    const isTrustedClient =
      activeThread &&
      ((d.security?.trustedEmails || []).includes((activeThread.customerEmail || "").toLowerCase()) ||
        (activeThread.diagnostics?.flagIds || []).includes("trusted_verified"));

    return `
      <!-- Barre de filtres par flags précis -->
      <div class="disc-admin-filters-bar">
        <button type="button" class="filter-pill ${this.discFilter === "all" ? "active" : ""}" data-disc-filter="all">
          Toutes (${threads.length})
        </button>
        <button type="button" class="filter-pill pill-filter-urgent ${this.discFilter === "fast_help" ? "active" : ""}" data-disc-filter="fast_help">
          ⚡ Urgences (${countFast})
        </button>
        <button type="button" class="filter-pill ${this.discFilter === "waiting" ? "active" : ""}" data-disc-filter="waiting">
          ⏳ En attente (${countWaiting})
        </button>
        <button type="button" class="filter-pill pill-filter-ai ${this.discFilter === "ai_active" ? "active" : ""}" data-disc-filter="ai_active">
          🤖 Relais IA (${countAi})
        </button>
        <button type="button" class="filter-pill pill-filter-fraud ${this.discFilter === "furious" ? "active" : ""}" data-disc-filter="furious">
          🤬 Très en colère (${countFurious})
        </button>
        <button type="button" class="filter-pill pill-filter-annoyed ${this.discFilter === "annoyed" ? "active" : ""}" data-disc-filter="annoyed">
          😤 Agacé (${countAnnoyed})
        </button>
        <button type="button" class="filter-pill pill-filter-anxious ${this.discFilter === "anxious" ? "active" : ""}" data-disc-filter="anxious">
          😟 Inquiet (${countAnxious})
        </button>
        <button type="button" class="filter-pill pill-filter-fraud ${this.discFilter === "fraud" ? "active" : ""}" data-disc-filter="fraud">
          🚨 Risque Fraude (${countFraud})
        </button>
        <button type="button" class="filter-pill pill-filter-fraud ${this.discFilter === "pressure" ? "active" : ""}" data-disc-filter="pressure">
          💳 Chargeback/Pression (${countPressure})
        </button>
        <button type="button" class="filter-pill pill-filter-ready ${this.discFilter === "ready" ? "active" : ""}" data-disc-filter="ready">
          🛒 Prêt à acheter (${countReady})
        </button>
        <button type="button" class="filter-pill pill-filter-vip ${this.discFilter === "vip" ? "active" : ""}" data-disc-filter="vip">
          ⭐ VIP (${countVip})
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
              <p style="margin-top:0.35rem;">Les flags automatiques (émotion, fraude comportementale, intention d'achat, urgence) se mettent à jour en temps réel à chaque action client sur le site.</p>
            </div>
          `
          : `
            <div class="admin-discussions-split ${this.mobileDetailOpen ? "mobile-detail-open" : ""}">
              <!-- Colonne Gauche : Liste conversations avec flags précis & score fraude -->
              <div class="admin-disc-list-pane">
                ${filtered
                  .map((t) => {
                    const dg = t.diagnostics;
                    const isSelected = t.threadId === activeThread?.threadId;
                    const liveWait = dg.waitingSince ? formatLiveWaitingLabel(dg.waitingSince) : null;
                    const topFlags = (dg.flags || []).filter((f) => f.id !== "waiting_long").slice(0, 5);
                    const riskCls = getRiskMeterClass(dg.riskScore);

                    return `
                      <button
                        type="button"
                        class="admin-disc-item-card ${isSelected ? "selected" : ""} ${dg.needsFastHelp ? "urgent-border" : ""} ${dg.isSuspectedFraud || dg.isFurious ? "fraud-border" : ""}"
                        data-select-thread="${escapeHtml(t.threadId)}"
                      >
                        <div class="disc-card-row-top">
                          <div class="disc-client-ident">
                            <strong>${escapeHtml(t.customerName || "Visiteur")}</strong>
                            ${t.unreadByAdmin > 0 ? `<span class="unread-dot-count">${t.unreadByAdmin}</span>` : ""}
                            <span class="acct-mini-tag ${dg.isAccountHolder ? "logged" : ""}">${dg.isAccountHolder ? "Compte" : "Invité"}</span>
                          </div>
                          <span class="risk-chip-mini ${riskCls}" title="Score de risque anti-fraude (${dg.riskConfidence || 0}% confiance)">
                            ${dg.riskScore}/100
                          </span>
                        </div>

                        <div class="disc-diagnostic-badges">
                          ${(() => {
                            const rm = getRelayStatusMeta(t.aiControl);
                            return `<span class="diag-badge relay-pill-mini ${rm.cls}" ${rm.relayDueAt ? `data-relay-countdown="${escapeHtml(rm.relayDueAt)}"` : ""}>${escapeHtml(rm.label)}</span>`;
                          })()}
                          ${
                            liveWait
                              ? `<span class="diag-badge diag-wait-${dg.waitingLevel}" data-waiting-since="${escapeHtml(dg.waitingSince)}">⏳ ${escapeHtml(liveWait)}</span>`
                              : ""
                          }
                          ${topFlags
                            .map(
                              (f) => `<span class="diag-badge ${escapeHtml(f.colorClass)}" title="${escapeHtml(f.reason || f.description)}">${f.icon} ${escapeHtml(f.shortLabel)}</span>`
                            )
                            .join("")}
                          ${dg.isResolved ? `<span class="diag-badge diag-resolved">✅ Résolu</span>` : ""}
                        </div>

                        <p class="disc-preview-snippet">${escapeHtml(dg.lastMessagePreview)}</p>
                      </button>
                    `;
                  })
                  .join("")}
              </div>

              <!-- Colonne Droite : Fiche Diagnostic Complète, Éditeur de Flags & Fil de Discussion -->
              <div class="admin-disc-detail-pane">
                ${activeThread ? this.renderSelectedDiscussionDetail(activeThread, d, isBlockedClient, isTrustedClient, savedDraft) : ""}
              </div>
            </div>
          `
      }
    `;
  }

  renderSelectedDiscussionDetail(t, d, isBlockedClient, isTrustedClient, savedDraft = "") {
    const dg = t.diagnostics;
    const liveWait = dg.waitingSince ? formatLiveWaitingLabel(dg.waitingSince) : null;
    const flagDefs = d.flagDefinitions || [];
    const activeFlags = dg.flags || [];
    const manualFlags = t.manualFlags || {};
    const riskCls = getRiskMeterClass(dg.riskScore);

    const groupedDefs = ["fraud", "emotion", "urgency", "commercial"].map((cat) => ({
      cat,
      title: FLAG_CATEGORY_LABELS[cat],
      items: flagDefs.filter((f) => f.category === cat && f.manualToggleable)
    }));

    return `
      <div class="disc-detail-header">
        <button type="button" class="btn btn-secondary btn-xs mobile-back-threads-btn" id="btn-admin-back-threads">
          ← Liste des discussions
        </button>
        <div class="disc-detail-client-meta">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <h2>${escapeHtml(t.customerName)}</h2>
              ${t.customerEmail ? `<code>${escapeHtml(t.customerEmail)}</code>` : `<span class="text-subtle-sm">(E-mail non renseigné)</span>`}
              <span class="acct-mini-tag ${dg.isAccountHolder ? "logged" : ""}">${dg.isAccountHolder ? "✅ Compte client actif" : "👻 Visiteur invité"}</span>
              <span class="pm-pill-badge">${escapeHtml(t.topicLabel)}</span>
            </div>
            <span class="fraud-score-pill ${riskCls}">
              Risque Fraude : <strong>${dg.riskScore}/100</strong> (${getRiskLevelLabel(dg.riskScore)} • Conf. ${dg.riskConfidence || 0}%)
            </span>
          </div>

          <!-- Tous les flags actifs précis avec origine Auto/Manuel et suppression 1-clic -->
          <div class="disc-diagnostic-badges" style="margin-top:0.55rem;">
            ${
              liveWait
                ? `<span class="diag-badge diag-wait-${dg.waitingLevel}" data-waiting-since="${escapeHtml(dg.waitingSince)}">⏳ ${escapeHtml(liveWait)}</span>`
                : `<span class="diag-badge diag-resolved">✓ À jour</span>`
            }
            ${activeFlags
              .filter((f) => f.id !== "waiting_long")
              .map(
                (f) => `
                <span class="diag-badge ${escapeHtml(f.colorClass)} diag-badge-interactive" title="${escapeHtml(f.reason || f.description)}">
                  <span>${f.icon} ${escapeHtml(f.label)}</span>
                  <em class="flag-src-tag">${f.source === "manual" ? "M" : "A"}</em>
                  ${
                    f.manualToggleable
                      ? `<button type="button" class="flag-dismiss-x" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-id="${escapeHtml(f.id)}" data-flag-val="false" aria-label="Retirer le flag ${escapeHtml(f.label)}">×</button>`
                      : ""
                  }
                </span>
              `
              )
              .join("")}
            ${
              dg.linkedOrderIds?.length
                ? dg.linkedOrderIds
                    .map(
                      (oid) => `<button type="button" class="diag-badge diag-order-link" data-deliver-order="${escapeHtml(oid)}">📦 Commande #${escapeHtml(oid)} →</button>`
                    )
                    .join("")
                : ""
            }
          </div>
        </div>

        <!-- Barre de Contrôle Relais Humain ↔ IA Gemini -->
        ${(() => {
          const rm = getRelayStatusMeta(t.aiControl);
          const aiHasKey = Boolean(d.settings?.ai?.hasApiKey);
          const aiErr = t.aiControl?.lastError || d.settings?.ai?.lastError || "";
          return `
            <div class="admin-relay-control-bar">
              <div class="relay-status-info">
                <span class="relay-status-pill ${rm.cls}" ${rm.relayDueAt ? `data-relay-countdown="${escapeHtml(rm.relayDueAt)}"` : ""}>${escapeHtml(rm.label)}</span>
                <span class="relay-status-hint">${
                  !aiHasKey
                    ? "⚠️ Clé API Gemini absente sur ce serveur — ajoutez-la dans Config (📲) pour que l'IA réponde."
                    : aiErr
                    ? `⚠️ Erreur IA : ${escapeHtml(aiErr.slice(0, 120))}`
                    : rm.mode === "ai_active"
                    ? "L'IA Gemini répond automatiquement au client."
                    : rm.mode === "waiting_human"
                    ? "En attente de votre réponse (l'IA prend le relais à la fin du chrono)."
                    : "Vous avez la main : l'IA est silencieuse."
                }</span>
              </div>
              <div class="relay-action-btns">
                <button
                  type="button"
                  class="btn btn-xs btn-relay-human"
                  data-relay-action="take_human"
                  data-relay-thread="${escapeHtml(t.threadId)}"
                  ${rm.mode === "human_active" ? "disabled" : ""}
                >👤 Reprendre le relais</button>
                <button
                  type="button"
                  class="btn btn-xs btn-relay-ai"
                  data-relay-action="release_to_ai"
                  data-relay-thread="${escapeHtml(t.threadId)}"
                  ${rm.mode === "ai_active" ? "disabled" : ""}
                >🤖 Perdre le relais</button>
              </div>
            </div>
          `;
        })()}

        <!-- Barre d'actions rapides & sélecteur complet de flags -->
        <div class="disc-manual-flags-bar">
          <button type="button" class="btn btn-outline btn-xs" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-key="status" data-flag-val="${dg.isResolved ? "open" : "resolved"}">
            ${dg.isResolved ? "↺ Rouvrir" : "✅ Marquer résolu"}
          </button>
          <button type="button" class="btn btn-outline btn-xs ${isTrustedClient ? "active-trust-btn" : ""}" data-trust-client="${escapeHtml(t.threadId)}" data-trust-val="${!isTrustedClient}">
            ${isTrustedClient ? "🛡️ Client Fiable ✓" : "🛡️ Marquer Fiable"}
          </button>
          <button type="button" class="btn btn-outline btn-xs danger-btn" data-block-client="${escapeHtml(t.threadId)}" data-block-val="${!isBlockedClient}">
            ${isBlockedClient ? "Débloquer client" : "🚫 Bloquer (Mail+IP+Appareil)"}
          </button>
          <button type="button" class="btn btn-outline btn-xs" data-delete-thread="${escapeHtml(t.threadId)}" title="Supprimer la discussion">🗑️</button>
        </div>

        <!-- Sélecteur granulaire de tous les flags manuels/auto -->
        <details class="admin-flag-picker-details">
          <summary>🏷️ Modifier / Ajouter des flags précis (${activeFlags.length} actifs)</summary>
          <div class="flag-picker-groups">
            ${groupedDefs
              .map(
                (grp) => `
                <div class="flag-picker-group">
                  <span class="flag-picker-cat">${grp.title}</span>
                  <div class="flag-picker-pills">
                    ${grp.items
                      .map((f) => {
                        const isActive = (dg.flagIds || []).includes(f.id);
                        const hasManual = manualFlags[f.id] !== undefined;
                        return `
                          <button
                            type="button"
                            class="flag-toggle-pill ${isActive ? "is-on" : ""} ${hasManual ? "is-manual" : ""}"
                            data-flag-thread="${escapeHtml(t.threadId)}"
                            data-flag-id="${escapeHtml(f.id)}"
                            data-flag-val="${isActive ? "false" : "true"}"
                            title="${escapeHtml(f.description)}"
                          >
                            ${f.icon} ${escapeHtml(f.shortLabel)}
                          </button>
                          ${
                            hasManual
                              ? `<button type="button" class="flag-reset-auto" data-flag-thread="${escapeHtml(t.threadId)}" data-flag-id="${escapeHtml(f.id)}" data-flag-val="auto" title="Remettre en détection automatique">↺</button>`
                              : ""
                          }
                        `;
                      })
                      .join("")}
                  </div>
                </div>
              `
              )
              .join("")}
          </div>

          <form class="admin-private-note-form" data-note-thread="${escapeHtml(t.threadId)}">
            <label class="form-label" style="font-size:0.74rem;">📝 Note privée administrateur (invisible pour le client)</label>
            <div style="display:flex;gap:0.45rem;">
              <input type="text" name="adminNotes" class="form-control form-control-sm" value="${escapeHtml(t.adminNotes || "")}" placeholder="Ex : Virement vérifié sur Caisse d'Épargne, client régulier..." />
              <button type="submit" class="btn btn-secondary btn-xs">Enregistrer</button>
            </div>
          </form>
        </details>
      </div>

      <!-- Analyse Anti-Fraude Multi-Dimensionnelle & Parcours Complet sur le Site -->
      ${renderFraudAnalyticsPanel(dg.fraudAssessment, { openByDefault: dg.riskScore >= 40 })}

      <!-- Messages de la conversation -->
      <div class="admin-disc-messages-box" id="admin-disc-scroll">
        ${(t.messages || []).map((m) => renderAdminChatBubble(m, t.customerName)).join("")}
      </div>

      <!-- Réponses rapides contextuelles selon les flags -->
      <div class="admin-quick-replies-row">
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Bonjour ! Oui, cet abonnement est en stock avec livraison immédiate dans votre coffre sécurisé et par e-mail dès validation.">
          🛒 Conclure vente
        </button>
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Rassurez-vous, votre règlement est 100% suivi et sécurisé ! Je vérifie votre transaction immédiatement et vous livre vos accès dans quelques instants.">
          😟 Rassurer client inquiet
        </button>
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Je suis vraiment désolé pour cette attente et je comprends parfaitement votre frustration. Je prends votre dossier en priorité absolue dès maintenant.">
          🤬 Apaiser colère / agacement
        </button>
        <button type="button" class="quick-prompt-chip sm" data-admin-quick="Par mesure de sécurité anti-fraude, nous attendons la confirmation effective des fonds sur notre banque avant d'envoyer vos identifiants. Merci de nous préciser le nom exact du titulaire du compte émetteur.">
          🚨 Vérification anti-fraude
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
  // ESPACE "📁 DOSSIERS" : TRAÇAGE COMPLET DES ACHATS & PERTE DE BIEN
  // ==========================================================================
  renderDossiersTab(d) {
    const dossiers = d.dossiers || [];
    const orphans = d.orphanClaims || [];
    const s = d.stats || {};
    const q = this.dossierSearch.trim().toLowerCase();

    const matchesSearch = (dos) => {
      if (!q) return true;
      const hay = [
        dos.dossierId,
        dos.orderId,
        dos.sepaRef,
        dos.recoveryCode,
        dos.proofSignature,
        dos.recoveredContact,
        dos.dossierNotes,
        dos.identity?.customerName,
        dos.identity?.email,
        dos.identity?.canonicalEmail,
        dos.identity?.phone,
        dos.identity?.notes,
        dos.payment?.transactionId,
        dos.payment?.payerTrace?.name,
        dos.payment?.payerTrace?.email,
        dos.payment?.payerTrace?.phone,
        dos.payment?.payerTrace?.senderHint,
        dos.trace?.ipAddress,
        dos.trace?.clientHash,
        dos.trace?.visitorId,
        dos.trace?.deviceFingerprint,
        ...(dos.goods?.items || []).map((i) => i.title)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    };

    const countLost = dossiers.filter((x) => x.dossierStatus === "lost_goods" || x.linkedClaims?.length > 0).length;
    const countInvestigating = dossiers.filter((x) => x.dossierStatus === "investigating").length;
    const countToDeliver = dossiers.filter(
      (x) => (x.payment?.status === "paid" || x.payment?.status === "declaration_sent") && x.goods?.deliveryStatus !== "delivered"
    ).length;
    const countDelivered = dossiers.filter((x) => x.goods?.deliveryStatus === "delivered").length;
    const countRisk = dossiers.filter((x) => (x.riskScore || 0) >= 45).length;

    const filtered = dossiers.filter((dos) => {
      if (!matchesSearch(dos)) return false;
      if (this.dossierFilter === "lost") return dos.dossierStatus === "lost_goods" || dos.linkedClaims?.length > 0;
      if (this.dossierFilter === "investigating") return dos.dossierStatus === "investigating";
      if (this.dossierFilter === "to_deliver") {
        return (dos.payment?.status === "paid" || dos.payment?.status === "declaration_sent") && dos.goods?.deliveryStatus !== "delivered";
      }
      if (this.dossierFilter === "delivered") return dos.goods?.deliveryStatus === "delivered";
      if (this.dossierFilter === "risk") return (dos.riskScore || 0) >= 45;
      return true;
    });

    if (!this.selectedDossierId || !filtered.some((x) => x.orderId === this.selectedDossierId)) {
      this.selectedDossierId = filtered[0]?.orderId || null;
    }
    const activeDossier = filtered.find((x) => x.orderId === this.selectedDossierId) || null;
    const isOrphansView = this.dossierFilter === "orphans";

    return `
      <div class="admin-kpi-row four-cols">
        <div class="kpi-box">
          <span class="kpi-val">${dossiers.length}</span>
          <span class="kpi-lbl">Dossiers d'achat tracés</span>
        </div>
        <div class="kpi-box">
          <span class="kpi-val">${countDelivered}</span>
          <span class="kpi-lbl">Biens livrés</span>
        </div>
        <div class="kpi-box ${countLost > 0 ? "danger-kpi" : ""}">
          <span class="kpi-val">${countLost}</span>
          <span class="kpi-lbl">Pertes / Incidents liés</span>
        </div>
        <div class="kpi-box ${orphans.length > 0 ? "highlight-kpi" : ""}">
          <span class="kpi-val">${orphans.length}</span>
          <span class="kpi-lbl">Signalements à rattacher</span>
        </div>
      </div>

      <div class="customers-toolbar">
        <div class="admin-filter-pills" style="margin-bottom:0;">
          <button type="button" class="filter-pill ${this.dossierFilter === "all" ? "active" : ""}" data-dossier-filter="all">
            Tous (${dossiers.length})
          </button>
          <button type="button" class="filter-pill pill-filter-fraud ${this.dossierFilter === "lost" ? "active" : ""}" data-dossier-filter="lost">
            🆘 Pertes / Incidents (${countLost})
          </button>
          <button type="button" class="filter-pill ${this.dossierFilter === "investigating" ? "active" : ""}" data-dossier-filter="investigating">
            🔎 Enquête (${countInvestigating})
          </button>
          <button type="button" class="filter-pill pill-filter-urgent ${this.dossierFilter === "to_deliver" ? "active" : ""}" data-dossier-filter="to_deliver">
            📦 À livrer (${countToDeliver})
          </button>
          <button type="button" class="filter-pill ${this.dossierFilter === "delivered" ? "active" : ""}" data-dossier-filter="delivered">
            ✅ Livrés (${countDelivered})
          </button>
          <button type="button" class="filter-pill pill-filter-fraud ${this.dossierFilter === "risk" ? "active" : ""}" data-dossier-filter="risk">
            🚨 À risque (${countRisk})
          </button>
          <button type="button" class="filter-pill pill-filter-urgent ${this.dossierFilter === "orphans" ? "active" : ""}" data-dossier-filter="orphans">
            🔗 Non rattachés (${orphans.length})
          </button>
        </div>

        ${
          !isOrphansView
            ? `
            <search>
              <label for="admin-dossier-search" class="visually-hidden">Rechercher dans les dossiers</label>
              <input
                type="search"
                id="admin-dossier-search"
                class="form-control form-control-sm"
                value="${escapeHtml(this.dossierSearch)}"
                placeholder="Nom, e-mail, tél, IP, REC-..., #NX-..., titulaire..."
              />
            </search>
          `
            : ""
        }
      </div>

      ${
        isOrphansView
          ? this.renderOrphanClaimsView(orphans, dossiers)
          : filtered.length === 0
          ? `<div class="admin-empty-state" style="margin-top:0.85rem;"><p><strong>Aucun dossier d'achat correspondant.</strong></p><p style="margin-top:0.35rem;">Chaque commande crée automatiquement un dossier forensique complet (IP, appareil, visiteur, preuves de paiement, suivi d'accès).</p></div>`
          : `
            <div class="admin-dossiers-split ${this.mobileDossierDetailOpen ? "mobile-detail-open" : ""}">
              <div class="admin-dossiers-list-pane">
                ${filtered
                  .map((dos) => {
                    const isSel = dos.orderId === activeDossier?.orderId;
                    const st = DOSSIER_STATUS_META[dos.dossierStatus] || DOSSIER_STATUS_META.normal;
                    const matchCount =
                      (dos.crossMatches?.orders?.length || 0) +
                      (dos.crossMatches?.users?.length || 0) +
                      (dos.crossMatches?.discussions?.length || 0);
                    return `
                      <button
                        type="button"
                        class="dossier-list-card ${isSel ? "selected" : ""} ${dos.dossierStatus === "lost_goods" || dos.linkedClaims?.length ? "lost-border" : ""}"
                        data-select-dossier="${escapeHtml(dos.orderId)}"
                      >
                        <div class="disc-card-row-top">
                          <div>
                            <strong>${escapeHtml(dos.dossierId)}</strong>
                            <span class="order-date-text">(#${escapeHtml(dos.orderId)})</span>
                          </div>
                          <span class="dossier-status-pill ${st.cls}">${st.label}</span>
                        </div>

                        <div style="font-size:0.86rem;font-weight:700;color:#fff;">
                          ${escapeHtml(dos.identity?.customerName || "Client")} • ${dos.payment?.total} €
                        </div>
                        <div class="text-subtle-sm" style="word-break:break-all;">
                          ${escapeHtml(dos.identity?.email || "")}${dos.identity?.phone ? ` • ${escapeHtml(dos.identity.phone)}` : ""}
                        </div>

                        <div class="disc-diagnostic-badges">
                          <span class="diag-badge ${dos.goods?.deliveryStatus === "delivered" ? "diag-resolved" : "diag-fast-help"}">
                            ${dos.goods?.deliveryStatus === "delivered" ? "📦 Livré" : "⏳ En attente"}
                          </span>
                          ${dos.trace?.ipAddress ? `<span class="diag-badge diag-wait-normal">🌐 ${escapeHtml(dos.trace.ipAddress)}</span>` : ""}
                          ${matchCount > 0 ? `<span class="diag-badge diag-order-link">🔗 ${matchCount} lien(s)</span>` : ""}
                          ${dos.linkedClaims?.length ? `<span class="diag-badge diag-fraud">🆘 ${dos.linkedClaims.length} ticket(s)</span>` : ""}
                        </div>
                      </button>
                    `;
                  })
                  .join("")}
              </div>

              <div class="admin-dossiers-detail-pane">
                ${activeDossier ? this.renderSelectedDossierDetail(activeDossier, d) : ""}
              </div>
            </div>
          `
      }
    `;
  }

  renderOrphanClaimsView(orphans, dossiers) {
    if (!orphans.length) {
      return `<div class="admin-empty-state" style="margin-top:0.85rem;"><p>Aucun signalement de perte orphelin : tous les dossiers sont rattachés.</p></div>`;
    }
    return `
      <div class="admin-orders-list" style="margin-top:0.85rem;">
        ${orphans
          .map((cl) => {
            const cands = cl.candidates || [];
            return `
              <div class="admin-order-card fraud-border">
                <div class="order-card-top">
                  <div>
                    <span class="order-badge-id">#${escapeHtml(cl.id)}</span>
                    <span class="order-date-text">${new Date(cl.createdAt).toLocaleString("fr-FR")}</span>
                  </div>
                  <span class="dossier-status-pill st-lost_goods">${cl.kind === "loss_report" ? "🔎 Perte de bien" : "🛡️ Secours"}</span>
                </div>
                <div class="order-client-row">
                  <div><strong>${escapeHtml(cl.customerName)}</strong> • <code>${escapeHtml(cl.email)}</code>${cl.phone ? ` • <code>${escapeHtml(cl.phone)}</code>` : ""}</div>
                  <div><strong>${escapeHtml(cl.amountPaid || "?")} €</strong> (${escapeHtml(cl.paymentMethod || "?")})</div>
                </div>
                <div class="order-items-inline">
                  ${cl.oldEmail ? `Ancien e-mail : <code>${escapeHtml(cl.oldEmail)}</code> • ` : ""}
                  ${cl.orderRef ? `Réf citée : <code>${escapeHtml(cl.orderRef)}</code> • ` : ""}
                  ${cl.recoveryCode ? `Code : <code>${escapeHtml(cl.recoveryCode)}</code> • ` : ""}
                  Preuve : <strong>${escapeHtml(cl.paymentProof || "—")}</strong>
                  ${cl.trace?.ipAddress ? ` • IP : <code>${escapeHtml(cl.trace.ipAddress)}</code>` : ""}
                  ${cl.trace?.deviceFingerprint ? ` • Appareil : <code>${escapeHtml(cl.trace.deviceFingerprint)}</code>` : ""}
                </div>
                ${cl.problemDetails ? `<div class="order-notes-box">${escapeHtml(cl.problemDetails)}</div>` : ""}

                <div class="dossier-orphan-candidates">
                  <strong style="font-size:0.78rem;">Pistes automatiques proposées :</strong>
                  ${
                    cands.length
                      ? cands
                          .map(
                            (ca) => `
                            <div class="dossier-cand-row">
                              <span><strong>#${escapeHtml(ca.orderId)}</strong> (${ca.matchScore}%) — ${escapeHtml(ca.customerName)} • <code>${escapeHtml(ca.email)}</code> (${escapeHtml((ca.matchReasons || []).join(", "))})</span>
                              <button type="button" class="btn btn-primary btn-xs" data-link-claim="${escapeHtml(cl.id)}" data-link-order="${escapeHtml(ca.orderId)}">
                                🔗 Rattacher à #${escapeHtml(ca.orderId)}
                              </button>
                            </div>
                          `
                          )
                          .join("")
                      : `<div style="display:flex;gap:0.45rem;align-items:center;flex-wrap:wrap;margin-top:0.35rem;">
                          <span class="text-subtle-sm">Aucune piste automatique :</span>
                          ${
                            dossiers.length
                              ? `<select class="form-control form-control-sm" style="max-width:260px;" id="manual-link-sel-${escapeHtml(cl.id)}">
                                  ${dossiers.slice(0, 30).map((dos) => `<option value="${escapeHtml(dos.orderId)}">#${escapeHtml(dos.orderId)} — ${escapeHtml(dos.identity?.customerName)} (${escapeHtml(dos.identity?.email)})</option>`).join("")}
                                </select>
                                <button type="button" class="btn btn-secondary btn-xs" data-link-claim-select="${escapeHtml(cl.id)}">🔗 Rattacher manuellement</button>`
                              : ""
                          }
                        </div>`
                  }
                </div>

                ${
                  cl.threadId
                    ? `<div class="order-admin-actions"><button type="button" class="btn btn-outline btn-xs" data-open-thread-from-dossier="${escapeHtml(cl.threadId)}">💬 Ouvrir la discussion #${escapeHtml(cl.threadId)}</button></div>`
                    : ""
                }
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  renderSelectedDossierDetail(dos, d) {
    const st = DOSSIER_STATUS_META[dos.dossierStatus] || DOSSIER_STATUS_META.normal;
    const tr = dos.trace || {};
    const pay = dos.payment || {};
    const payer = pay.payerTrace || {};
    const id = dos.identity || {};
    const creds = dos.goods?.deliveredAccess?.credentials || [];
    const linkedThread = dos.crossMatches?.discussions?.[0];

    return `
      <div class="disc-detail-header">
        <button type="button" class="btn btn-secondary btn-xs mobile-back-threads-btn" id="btn-admin-back-dossiers">
          ← Liste des dossiers
        </button>

        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <h2 style="font-size:1.1rem;">📁 ${escapeHtml(dos.dossierId)} <span class="text-subtle-sm">(#${escapeHtml(dos.orderId)})</span></h2>
              <span class="dossier-status-pill ${st.cls}">${st.label}</span>
              ${dos.recoveryCode ? `<code title="Code de récupération client">${escapeHtml(dos.recoveryCode)}</code>` : ""}
            </div>
            <p class="text-subtle-sm" style="margin-top:0.25rem;">
              Créé le ${new Date(dos.createdAt).toLocaleString("fr-FR")} • Dernière maj ${new Date(dos.updatedAt).toLocaleString("fr-FR")}
            </p>
          </div>

          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-xs" data-deliver-order="${escapeHtml(dos.orderId)}">
              🚀 ${dos.goods?.deliveryStatus === "delivered" ? "Accès & Chat" : "Livrer les accès"}
            </button>
            ${
              linkedThread
                ? `<button type="button" class="btn btn-secondary btn-xs" data-open-thread-from-dossier="${escapeHtml(linkedThread.threadId)}">💬 Discussion</button>`
                : ""
            }
            <button type="button" class="btn btn-outline btn-xs" id="btn-export-dossier" data-export-order="${escapeHtml(dos.orderId)}">
              📥 Exporter Fiche (.txt)
            </button>
          </div>
        </div>
      </div>

      <!-- 1. Identité & Coordonnées Acheteur -->
      <div class="dossier-section-card">
        <h3>👤 1. Identité &amp; Coordonnées pour Retrouver l'Acheteur</h3>
        <div class="dossier-kv-grid">
          <div class="dossier-kv"><span>Nom complet</span><strong>${escapeHtml(id.customerName || "—")}</strong></div>
          <div class="dossier-kv"><span>E-mail principal</span><code>${escapeHtml(id.email || "—")}</code></div>
          <div class="dossier-kv"><span>E-mail canonique (anti-alias)</span><code>${escapeHtml(id.canonicalEmail || "—")}</code></div>
          <div class="dossier-kv"><span>Téléphone / WhatsApp</span><strong>${escapeHtml(id.phone || "Non renseigné")}</strong></div>
          <div class="dossier-kv"><span>Contact retrouvé / corrigé</span><strong>${escapeHtml(dos.recoveredContact || "—")}</strong></div>
          <div class="dossier-kv"><span>Compte client NEXUS</span><strong>${id.userId ? `✅ ${escapeHtml(id.accountName || id.userId)} (${escapeHtml(id.accountStatus || "active")})` : "👻 Commande invité"}</strong></div>
        </div>
        ${id.notes ? `<div class="order-notes-box" style="margin-top:0.5rem;">Note client : ${escapeHtml(id.notes)}</div>` : ""}
      </div>

      <!-- 2. Traçage Forensique Réseau, Appareil & Navigateur -->
      <div class="dossier-section-card">
        <h3>🌐 2. Empreinte Forensique (Réseau, Appareil &amp; Navigateur)</h3>
        <div class="dossier-kv-grid">
          <div class="dossier-kv"><span>Adresse IP</span><code>${escapeHtml(tr.ipAddress || "Inconnue")}</code></div>
          <div class="dossier-kv"><span>Chaîne IP proxy</span><code>${escapeHtml((tr.forwardedIps || []).join(" → ") || "—")}</code></div>
          <div class="dossier-kv"><span>Empreinte appareil (SHA-256)</span><code>${escapeHtml(tr.deviceFingerprint || "—")}</code></div>
          <div class="dossier-kv"><span>ID Visiteur permanent</span><code>${escapeHtml(tr.visitorId || "—")}</code></div>
          <div class="dossier-kv"><span>Empreinte réseau (HMAC)</span><code>${escapeHtml(tr.clientHash || "—")}</code></div>
          <div class="dossier-kv"><span>ID Session</span><code>${escapeHtml(tr.sessionId || "—")}</code></div>
          <div class="dossier-kv"><span>Appareil / OS / Navigateur</span><strong>${escapeHtml(tr.userAgentSummary || "—")}</strong></div>
          <div class="dossier-kv"><span>Plateforme / CPU / RAM</span><strong>${escapeHtml([tr.platform, tr.hardwareConcurrency ? `${tr.hardwareConcurrency} cœurs` : "", tr.deviceMemory ? `${tr.deviceMemory} Go` : ""].filter(Boolean).join(" • ") || "—")}</strong></div>
          <div class="dossier-kv"><span>Écran / Viewport / Tactile</span><strong>${escapeHtml([tr.screenSize, tr.viewportSize ? `vp ${tr.viewportSize}` : "", tr.pixelRatio ? `@${tr.pixelRatio}x` : "", typeof tr.maxTouchPoints === "number" ? `${tr.maxTouchPoints} pts` : ""].filter(Boolean).join(" • ") || "—")}</strong></div>
          <div class="dossier-kv"><span>Fuseau horaire / Pays / Langue</span><strong>${escapeHtml([tr.timezone, tr.countryHint, tr.language].filter(Boolean).join(" • ") || "—")}</strong></div>
          <div class="dossier-kv"><span>Temps sur site / Remplissage</span><strong>${tr.sessionDurationSec !== null ? `${tr.sessionDurationSec}s` : "—"} / ${tr.formFillMs !== null ? `${Math.round(tr.formFillMs / 1000)}s` : "—"}</strong></div>
          <div class="dossier-kv"><span>Referrer / URL</span><span class="text-subtle-sm" style="word-break:break-all;">${escapeHtml(tr.referrer || tr.currentUrl || "Direct")}</span></div>
        </div>
        ${tr.userAgent ? `<div class="text-subtle-sm" style="margin-top:0.45rem;word-break:break-all;"><strong>User-Agent brut :</strong> <code>${escapeHtml(tr.userAgent)}</code></div>` : ""}
      </div>

      <!-- 3. Preuves Financières & Infos Payeur -->
      <div class="dossier-section-card">
        <h3>💳 3. Preuves Bancaires &amp; Informations Payeur</h3>
        <div class="dossier-kv-grid">
          <div class="dossier-kv"><span>Moyen / Statut</span><strong>${escapeHtml((pay.method || "").toUpperCase())} — ${escapeHtml(pay.status)}</strong></div>
          <div class="dossier-kv"><span>Montant TTC</span><strong>${pay.total} € (Sous-total ${pay.subtotal} €${pay.coupon ? ` • Promo ${escapeHtml(pay.coupon)}` : ""})</strong></div>
          <div class="dossier-kv"><span>Réf SEPA</span><code>${escapeHtml(dos.sepaRef || "—")}</code></div>
          <div class="dossier-kv"><span>ID Transaction</span><code>${escapeHtml(pay.transactionId || payer.paymentIntentId || payer.captureId || "—")}</code></div>
          <div class="dossier-kv"><span>Titulaire / Payeur détecté</span><strong>${escapeHtml(payer.name || payer.senderHint || "—")}</strong></div>
          <div class="dossier-kv"><span>E-mail / Pays Payeur</span><code>${escapeHtml([payer.email, payer.country, payer.payerId].filter(Boolean).join(" • ") || "—")}</code></div>
          <div class="dossier-kv"><span>Signature Certificat HMAC</span><code>${escapeHtml(dos.proofSignature || "—")}</code></div>
          <div class="dossier-kv"><span>Code Récupération</span><code>${escapeHtml(dos.recoveryCode || "—")}</code></div>
        </div>
      </div>

      <!-- 4. Bien Acheté & Suivi du Coffre d'Accès -->
      <div class="dossier-section-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <h3 style="margin:0;">📦 4. Biens Achetés &amp; Traçage de Consultation des Accès</h3>
          ${
            creds.length
              ? `<button type="button" class="btn btn-outline btn-xs" id="btn-toggle-dossier-secrets">
                  ${this.adminRevealDossierSecrets ? "🙈 Masquer identifiants" : "👁️ Révéler identifiants livrés"}
                </button>`
              : ""
          }
        </div>
        <div class="order-items-inline" style="margin-top:0.5rem;">
          ${(dos.goods?.items || []).map((i) => `${i.quantity}× <strong>${escapeHtml(i.title)}</strong> (${i.lineTotal} €)`).join(" • ")}
        </div>
        <div class="journey-kpis-grid" style="margin-top:0.55rem;">
          <div class="journey-kpi"><span>Ouvertures coffre</span><strong>${dos.accessMetrics?.vaultOpens || 0}</strong></div>
          <div class="journey-kpi"><span>Révélations mdp</span><strong>${dos.accessMetrics?.secretReveals || 0}</strong></div>
          <div class="journey-kpi"><span>Copies identifiants</span><strong>${dos.accessMetrics?.credentialCopies || 0}</strong></div>
          <div class="journey-kpi"><span>Preuves (.txt)</span><strong>${dos.accessMetrics?.proofDownloads || 0}</strong></div>
        </div>
        ${
          creds.length
            ? `
            <div style="margin-top:0.6rem;display:flex;flex-direction:column;gap:0.45rem;">
              ${creds
                .map(
                  (c) => `
                  <div style="padding:0.55rem 0.7rem;border-radius:var(--radius-sm);background:rgba(255,255,255,0.03);border:1px solid var(--border-light);font-size:0.8rem;">
                    <strong>${escapeHtml(c.productTitle || "Accès")}</strong>
                    ${c.inviteLink ? `<div>Lien : <code>${this.adminRevealDossierSecrets ? escapeHtml(c.inviteLink) : "•••••••• (masqué)"}</code></div>` : ""}
                    ${c.login ? `<div>Login : <code>${escapeHtml(c.login)}</code></div>` : ""}
                    ${c.password ? `<div>Mdp : <code>${this.adminRevealDossierSecrets ? escapeHtml(c.password) : "••••••••"}</code></div>` : ""}
                    ${c.profile || c.pin ? `<div>Profil : ${escapeHtml(c.profile || "—")} • PIN : <code>${this.adminRevealDossierSecrets ? escapeHtml(c.pin || "—") : "••••"}</code></div>` : ""}
                  </div>
                `
                )
                .join("")}
            </div>
          `
            : `<p class="text-subtle-sm" style="margin-top:0.5rem;">Aucun identifiant encore livré pour cette commande.</p>`
        }
      </div>

      <!-- 5. Correspondances Automatiques (Retrouver le client) -->
      <div class="dossier-section-card">
        <h3>🔗 5. Correspondances Automatiques (Autres achats, comptes &amp; discussions liés)</h3>
        ${
          !(dos.crossMatches?.orders?.length || dos.crossMatches?.users?.length || dos.crossMatches?.discussions?.length)
            ? `<p class="text-subtle-sm">Aucune autre entité reliée à cette empreinte pour le moment.</p>`
            : `
            <div class="dossier-matches-list">
              ${(dos.crossMatches.orders || [])
                .map(
                  (mo) => `
                  <button type="button" class="dossier-match-chip" data-select-dossier-jump="${escapeHtml(mo.orderId)}">
                    <span>📦 Commande <strong>#${escapeHtml(mo.orderId)}</strong> (${escapeHtml(mo.customerName)} • ${escapeHtml(mo.email)})</span>
                    <em>${escapeHtml((mo.reasons || []).join(", "))}</em>
                  </button>
                `
                )
                .join("")}
              ${(dos.crossMatches.users || [])
                .map(
                  (mu) => `
                  <span class="dossier-match-chip static">
                    <span>👤 Compte <strong>${escapeHtml(mu.name)}</strong> (${escapeHtml(mu.email)})</span>
                    <em>${escapeHtml((mu.reasons || []).join(", "))}</em>
                  </span>
                `
                )
                .join("")}
              ${(dos.crossMatches.discussions || [])
                .map(
                  (md) => `
                  <button type="button" class="dossier-match-chip" data-open-thread-from-dossier="${escapeHtml(md.threadId)}">
                    <span>💬 Discussion <strong>#${escapeHtml(md.threadId)}</strong> (${escapeHtml(md.topicLabel)})</span>
                    <em>${escapeHtml((md.reasons || []).join(", "))}</em>
                  </button>
                `
                )
                .join("")}
            </div>
          `
        }
      </div>

      <!-- 6. Signalements de Perte / Secours Rattachés -->
      ${
        dos.linkedClaims?.length
          ? `
          <div class="dossier-section-card lost-card">
            <h3>🆘 6. Signalements de Perte / Secours Rattachés (${dos.linkedClaims.length})</h3>
            ${dos.linkedClaims
              .map(
                (lc) => `
                <div style="padding:0.55rem 0.7rem;border-radius:var(--radius-sm);background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);margin-top:0.45rem;font-size:0.8rem;">
                  <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
                    <strong>#${escapeHtml(lc.id)} (${escapeHtml(lc.lossType || "secours")})</strong>
                    <span>${new Date(lc.createdAt).toLocaleString("fr-FR")}</span>
                  </div>
                  <div>Contact signalé : ${escapeHtml(lc.customerName)} • <code>${escapeHtml(lc.email)}</code>${lc.oldEmail ? ` (ancien: <code>${escapeHtml(lc.oldEmail)}</code>)` : ""}${lc.phone ? ` • ${escapeHtml(lc.phone)}` : ""}</div>
                  ${lc.paymentProof ? `<div>Preuve : <strong>${escapeHtml(lc.paymentProof)}</strong></div>` : ""}
                  ${lc.problemDetails ? `<div style="margin-top:0.25rem;">${escapeHtml(lc.problemDetails)}</div>` : ""}
                </div>
              `
              )
              .join("")}
          </div>
        `
          : ""
      }

      <!-- 7. Chronologie Complète du Dossier -->
      <div class="dossier-section-card">
        <h3>🕒 7. Chronologie Complète des Événements (${dos.traceTimeline?.length || 0})</h3>
        ${
          dos.traceTimeline?.length
            ? `
            <ul class="dossier-timeline-list">
              ${dos.traceTimeline
                .slice(0, 25)
                .map(
                  (ev) => `
                  <li>
                    <span class="tl-time">${new Date(ev.ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <code class="tl-type">${escapeHtml(ev.type)}</code>
                    <span class="tl-label">${escapeHtml(ev.label)}${ev.detail ? ` — ${escapeHtml(ev.detail)}` : ""}</span>
                    ${ev.ipAddress ? `<code class="tl-ip">${escapeHtml(ev.ipAddress)}</code>` : ""}
                  </li>
                `
                )
                .join("")}
            </ul>
          `
            : `<p class="text-subtle-sm">Aucun événement enregistré pour cette commande.</p>`
        }
      </div>

      <!-- 8. Suivi d'Enquête & Notes Admin -->
      <form id="admin-dossier-update-form" class="dossier-section-card" data-dossier-order="${escapeHtml(dos.orderId)}">
        <h3>📝 8. Suivi d'Enquête &amp; Récupération Admin</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Statut du dossier</label>
            <select name="dossierStatus" class="form-control form-control-sm">
              <option value="normal" ${dos.dossierStatus === "normal" ? "selected" : ""}>Normal</option>
              <option value="lost_goods" ${dos.dossierStatus === "lost_goods" ? "selected" : ""}>🆘 Bien perdu signalé</option>
              <option value="investigating" ${dos.dossierStatus === "investigating" ? "selected" : ""}>🔎 Enquête en cours</option>
              <option value="recovered" ${dos.dossierStatus === "recovered" ? "selected" : ""}>✅ Retrouvé &amp; rétabli</option>
              <option value="disputed" ${dos.dossierStatus === "disputed" ? "selected" : ""}>⚠️ Litige / Contestation</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Téléphone client</label>
            <input type="text" name="phone" class="form-control form-control-sm" value="${escapeHtml(id.phone || "")}" placeholder="+33 6..." />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Contact retrouvé / E-mail corrigé</label>
          <input type="text" name="recoveredContact" class="form-control form-control-sm" value="${escapeHtml(dos.recoveredContact || "")}" placeholder="Ex : vrai.email@gmail.com (suite faute de frappe)" />
        </div>
        <div class="form-group">
          <label class="form-label">Notes d'enquête privées</label>
          <textarea name="dossierNotes" class="form-control" rows="2" placeholder="Détails de vérification bancaire, identité payeur, accès renvoyés...">${escapeHtml(dos.dossierNotes || "")}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-xs" style="align-self:flex-start;">✓ Enregistrer le dossier</button>
      </form>
    `;
  }

  exportDossierTxt(dos) {
    if (!dos) return;
    const tr = dos.trace || {};
    const pay = dos.payment || {};
    const payer = pay.payerTrace || {};
    const lines = [
      `=== FICHE DOSSIER FORENSIQUE ${dos.dossierId} (#${dos.orderId}) ===`,
      `Statut dossier   : ${dos.dossierStatus}`,
      `Code récupération: ${dos.recoveryCode || "N/A"}`,
      `Signature HMAC   : ${dos.proofSignature || "N/A"}`,
      `Date création    : ${dos.createdAt}`,
      `--- IDENTITE ---`,
      `Nom              : ${dos.identity?.customerName || ""}`,
      `Email            : ${dos.identity?.email || ""} (canonique: ${dos.identity?.canonicalEmail || ""})`,
      `Téléphone        : ${dos.identity?.phone || ""}`,
      `Contact retrouvé : ${dos.recoveredContact || ""}`,
      `--- TRACAGE RESEAU & APPAREIL ---`,
      `IP               : ${tr.ipAddress || ""} (proxy: ${(tr.forwardedIps || []).join(", ")})`,
      `Appareil FP      : ${tr.deviceFingerprint || ""}`,
      `Visiteur ID      : ${tr.visitorId || ""}`,
      `Client Hash      : ${tr.clientHash || ""}`,
      `Navigateur/OS    : ${tr.userAgentSummary || ""} | ${tr.userAgent || ""}`,
      `Ecran / Fuseau   : ${tr.screenSize || ""} | ${tr.timezone || ""} | ${tr.language || ""}`,
      `--- PAIEMENT ---`,
      `Mode / Statut    : ${pay.method} / ${pay.status} (${pay.total} EUR)`,
      `Réf SEPA / TxID  : ${dos.sepaRef || ""} / ${pay.transactionId || ""}`,
      `Payeur détecté   : ${payer.name || payer.senderHint || ""} (${payer.email || ""})`,
      `--- CHRONOLOGIE ---`,
      ...(dos.traceTimeline || []).map((ev) => `[${ev.ts}] ${ev.type}: ${ev.label} ${ev.detail || ""} (${ev.ipAddress || ""})`)
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Dossier-${dos.dossierId}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`Fiche ${dos.dossierId} exportée !`, "success");
  }

  // ==========================================================================
  // COMMANDES & LIVRAISON (AVEC ANALYSE ANTI-FRAUDE 6D PAR COMMANDE)
  // ==========================================================================
  renderOrdersTab(orders, stats) {
    const filtered = orders.filter((o) => {
      if (this.orderFilter === "to_deliver") {
        return (o.paymentStatus === "paid" || o.paymentStatus === "declaration_sent") && o.deliveryStatus !== "delivered";
      }
      if (this.orderFilter === "fraud_risk") return (o.riskScore || 0) >= 40;
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
        <div class="kpi-box ${(stats.highRiskOrdersCount || 0) > 0 ? "danger-kpi" : ""}">
          <span class="kpi-val">${stats.highRiskOrdersCount || 0}</span>
          <span class="kpi-lbl">Commandes à risque (≥45)</span>
        </div>
      </div>

      <div class="admin-filter-pills">
        <button type="button" class="filter-pill ${this.orderFilter === "all" ? "active" : ""}" data-ord-filter="all">Toutes (${orders.length})</button>
        <button type="button" class="filter-pill ${this.orderFilter === "to_deliver" ? "active" : ""}" data-ord-filter="to_deliver">À vérifier / livrer (${stats.pendingDeliveries})</button>
        <button type="button" class="filter-pill pill-filter-fraud ${this.orderFilter === "fraud_risk" ? "active" : ""}" data-ord-filter="fraud_risk">🚨 Risque Fraude (${stats.highRiskOrdersCount || 0})</button>
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
                  const score = Number(ord.riskScore || 0);
                  const isFraudRisk = score >= 45;
                  const riskCls = getRiskMeterClass(score);

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
                          ${ord.userId ? `<span class="acct-mini-tag logged" style="margin-left:0.4rem;">Compte</span>` : `<span class="acct-mini-tag" style="margin-left:0.4rem;">Invité</span>`}
                        </div>
                        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
                          <span class="fraud-score-pill ${riskCls}">Risque ${score}/100 (${getRiskLevelLabel(score)})</span>
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

                      ${ord.notes ? `<div class="order-notes-box">Note client : ${escapeHtml(ord.notes)}</div>` : ""}

                      ${renderFraudAnalyticsPanel(ord.fraudAssessment, {
                        openByDefault: score >= 50,
                        compactTitle: "🔬 Détail Anti-Fraude & Suivi Site de cette commande"
                      })}

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
  // NOUVEL ONGLET : CLIENTS, COMPTES & CENTRE ANTI-FRAUDE COMPORTEMENTAL
  // ==========================================================================
  renderCustomersAntiFraudTab(d) {
    const customers = d.customers || [];
    const visitors = d.trackedVisitors || [];
    const s = d.stats || {};
    const q = this.customerSearch.trim().toLowerCase();

    const filteredCustomers = customers.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false;
      if (this.customerFilter === "high_risk") return (c.fraudAssessment?.score || 0) >= 45;
      if (this.customerFilter === "vip") return c.flagIds.includes("vip_loyal") || c.trustedOverride;
      if (this.customerFilter === "suspended") return c.status === "suspended";
      return true;
    });

    const isVisitorsView = this.customerFilter === "visitors";

    return `
      <div class="admin-kpi-row four-cols">
        <div class="kpi-box">
          <span class="kpi-val">${s.totalCustomers || 0}</span>
          <span class="kpi-lbl">Comptes clients</span>
        </div>
        <div class="kpi-box">
          <span class="kpi-val">${s.activeCustomerSessions || 0}</span>
          <span class="kpi-lbl">Sessions actives</span>
        </div>
        <div class="kpi-box ${(s.highRiskCustomers || 0) > 0 ? "danger-kpi" : ""}">
          <span class="kpi-val">${s.highRiskCustomers || 0}</span>
          <span class="kpi-lbl">Comptes à risque (≥45)</span>
        </div>
        <div class="kpi-box">
          <span class="kpi-val">${s.trackedVisitorsCount || 0}</span>
          <span class="kpi-lbl">Visiteurs invités suivis</span>
        </div>
      </div>

      <div class="customers-toolbar">
        <div class="admin-filter-pills" style="margin-bottom:0;">
          <button type="button" class="filter-pill ${this.customerFilter === "all" ? "active" : ""}" data-cust-filter="all">
            Tous les comptes (${customers.length})
          </button>
          <button type="button" class="filter-pill pill-filter-fraud ${this.customerFilter === "high_risk" ? "active" : ""}" data-cust-filter="high_risk">
            🚨 À risque (${customers.filter((c) => (c.fraudAssessment?.score || 0) >= 45).length})
          </button>
          <button type="button" class="filter-pill pill-filter-vip ${this.customerFilter === "vip" ? "active" : ""}" data-cust-filter="vip">
            ⭐ VIP / Fiables (${customers.filter((c) => c.flagIds.includes("vip_loyal") || c.trustedOverride).length})
          </button>
          <button type="button" class="filter-pill ${this.customerFilter === "suspended" ? "active" : ""}" data-cust-filter="suspended">
            🚫 Suspendus (${customers.filter((c) => c.status === "suspended").length})
          </button>
          <button type="button" class="filter-pill ${this.customerFilter === "visitors" ? "active" : ""}" data-cust-filter="visitors">
            🧭 Visiteurs suivis (${visitors.length})
          </button>
        </div>

        ${
          !isVisitorsView
            ? `
            <search>
              <label for="admin-cust-search" class="visually-hidden">Rechercher un client</label>
              <input type="search" id="admin-cust-search" class="form-control form-control-sm" value="${escapeHtml(this.customerSearch)}" placeholder="Rechercher nom ou e-mail..." />
            </search>
          `
            : ""
        }
      </div>

      ${
        isVisitorsView
          ? this.renderTrackedVisitorsList(visitors)
          : filteredCustomers.length === 0
          ? `<div class="admin-empty-state"><p>Aucun compte client dans cette sélection.</p></div>`
          : `
            <div class="admin-orders-list" style="margin-top:0.85rem;">
              ${filteredCustomers
                .map((c) => {
                  const score = Number(c.fraudAssessment?.score || 0);
                  const riskCls = getRiskMeterClass(score);
                  const isSuspended = c.status === "suspended";
                  return `
                    <div class="admin-order-card ${score >= 45 || isSuspended ? "fraud-border" : "confirmed"}">
                      <div class="order-card-top">
                        <div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap;">
                          <strong style="font-size:1rem;">${escapeHtml(c.name)}</strong>
                          <code>${escapeHtml(c.email)}</code>
                          <span class="order-status-badge ${isSuspended ? "badge-suspended" : "badge-paid"}">
                            ${isSuspended ? "🚫 Suspendu" : "✓ Actif"}
                          </span>
                        </div>
                        <span class="fraud-score-pill ${riskCls}">
                          Risque Global : <strong>${score}/100</strong> (${getRiskLevelLabel(score)} • Conf. ${c.fraudAssessment?.confidence || 0}%)
                        </span>
                      </div>

                      <div class="order-items-inline">
                        Inscrit le ${new Date(c.createdAt).toLocaleDateString("fr-FR")} •
                        Commandes : <strong>${c.ordersCount}</strong> (${c.paidOrdersCount} payées • <strong>${c.totalSpent} €</strong>) •
                        Discussions : <strong>${c.discussionsCount}</strong>
                      </div>

                      <div class="disc-diagnostic-badges">
                        ${(c.flags || [])
                          .map(
                            (f) => `<span class="diag-badge ${escapeHtml(f.colorClass)}" title="${escapeHtml(f.reason || f.description)}">${f.icon} ${escapeHtml(f.label)}</span>`
                          )
                          .join("")}
                      </div>

                      ${renderFraudAnalyticsPanel(c.fraudAssessment, {
                        openByDefault: score >= 45,
                        compactTitle: "🔬 Profil Anti-Fraude (6 Dimensions) & Parcours Complet sur le Site"
                      })}

                      <form class="admin-private-note-form" data-customer-note="${escapeHtml(c.id)}">
                        <div style="display:flex;gap:0.45rem;">
                          <input type="text" name="adminNotes" class="form-control form-control-sm" value="${escapeHtml(c.adminNotes || "")}" placeholder="Note privée sur ce client (ex: client vérifié, à surveiller...)" />
                          <button type="submit" class="btn btn-secondary btn-xs">Noter</button>
                        </div>
                      </form>

                      <div class="order-admin-actions">
                        <button type="button" class="btn btn-outline btn-xs ${c.trustedOverride ? "active-trust-btn" : ""}" data-cust-action="trust" data-cust-id="${escapeHtml(c.id)}" data-val="${!c.trustedOverride}">
                          ${c.trustedOverride ? "🛡️ Whitelist Fiable ✓" : "🛡️ Marquer Client Fiable"}
                        </button>
                        <button type="button" class="btn btn-outline btn-xs" data-cust-action="flag-vip" data-cust-id="${escapeHtml(c.id)}" data-val="${!c.flagIds.includes("vip_loyal")}">
                          ${c.flagIds.includes("vip_loyal") ? "Retirer VIP" : "⭐ Marquer VIP"}
                        </button>
                        <button type="button" class="btn btn-outline btn-xs" data-cust-action="status" data-cust-id="${escapeHtml(c.id)}" data-val="${isSuspended ? "active" : "suspended"}">
                          ${isSuspended ? "▶️ Réactiver le compte" : "⏸️ Suspendre le compte"}
                        </button>
                        <button type="button" class="btn btn-outline btn-xs danger-btn" data-cust-action="block" data-cust-id="${escapeHtml(c.id)}" data-val="${!isSuspended}">
                          ${isSuspended ? "Débloquer tout" : "🚫 Bloquer (Compte+IP+Appareil)"}
                        </button>
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

  renderTrackedVisitorsList(visitors) {
    if (!visitors.length) {
      return `<div class="admin-empty-state" style="margin-top:0.85rem;"><p>Aucun visiteur anonyme enregistré pour le moment.</p></div>`;
    }
    return `
      <div class="admin-orders-list" style="margin-top:0.85rem;">
        ${visitors
          .map((v) => {
            const score = Number(v.fraudAssessment?.score || 0);
            const riskCls = getRiskMeterClass(score);
            return `
              <div class="admin-order-card ${score >= 45 ? "fraud-border" : ""}">
                <div class="order-card-top">
                  <div>
                    <strong>Visiteur <code>${escapeHtml(v.visitorId)}</code></strong>
                    ${v.email ? ` • <code>${escapeHtml(v.email)}</code>` : ""}
                    <span class="order-date-text">${escapeHtml(v.userAgentSummary || "")} • Vu ${new Date(v.lastSeenAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <span class="fraud-score-pill ${riskCls}">Risque ${score}/100 (${getRiskLevelLabel(score)})</span>
                </div>
                ${renderFraudAnalyticsPanel(v.fraudAssessment, {
                  openByDefault: score >= 35,
                  compactTitle: "🧭 Détail du suivi comportemental sur le site"
                })}
                <div class="order-admin-actions">
                  <button type="button" class="btn btn-outline btn-xs danger-btn" data-block-visitor="${escapeHtml(v.key)}">
                    🚫 Bloquer cette connexion / empreinte appareil
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
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
    const blockedEmails = securityInfo?.blockedEmails || [];
    const secEvents = securityInfo?.recentEvents || [];

    return `
      <form id="admin-settings-master-form" class="admin-integrations-stack">
        <div class="integration-panel highlight-integration">
          <div class="integration-head">
            <span class="legal-tag">iPhone (iOS) • Priorité CRITIQUE &amp; URGENTE</span>
            <h2>🚨 Notifications urgentes sur votre iPhone</h2>
            <p>Chaque <strong>achat</strong>, <strong>paiement</strong> et <strong>message client</strong> envoie immédiatement une alerte urgente sur votre iPhone. <strong>Recommandé : Bark (iPhone)</strong> — 100% gratuit, sans aucune limite de quota et sonne même en mode Silencieux / Ne pas déranger !</p>
          </div>

          <div style="padding:14px 16px;border-radius:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.35);margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
              <strong style="color:#f8fafc;font-size:15px;">🍎 Bark — Spécial iPhone (Recommandé, 0 limite)</strong>
              <label class="inline-check-pill">
                <input type="checkbox" id="cfg-bark-enabled" ${s.notifications.barkEnabled !== false ? "checked" : ""} />
                <span>Activer Bark iPhone</span>
              </label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">URL ou Clé Bark (ex: https://api.day.app/TaCleIci)</label>
                <input type="text" id="cfg-bark-url" class="form-control" value="${escapeHtml(s.notifications.barkUrl || "")}" placeholder="https://api.day.app/..." />
              </div>
              <div class="form-group">
                <label class="form-label">Son Bark (custom ou intégré)</label>
                <input type="text" id="cfg-bark-sound" class="form-control" value="${escapeHtml(s.notifications.barkSound || "mm")}" placeholder="mm" />
              </div>
            </div>
            <div style="margin-top:6px;">
              <label class="inline-check-pill">
                <input type="checkbox" id="cfg-bark-critical" ${s.notifications.barkCritical !== false ? "checked" : ""} />
                <span>🔊 Alerte Critique (sonne même en Silencieux)</span>
              </label>
            </div>
            <div style="font-size:12px;line-height:1.5;color:#cbd5e1;margin-top:6px;">
              <strong>Installation en 30 secondes :</strong> 1. Installez l'app gratuite <strong>Bark</strong> sur l'App Store → 2. Autorisez les notifications &amp; Alertes critiques → 3. Copiez votre lien <code>https://api.day.app/...</code> dans Bark et collez-le ci-dessus → 4. Cliquez sur <strong>Enregistrer</strong> puis <strong>Tester</strong> !
            </div>
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
                <span>Activer aussi ntfy.sh (optionnel)</span>
              </label>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Sujet privé ntfy.sh</label>
                  <input type="text" id="cfg-ntfy-topic" class="form-control" value="${escapeHtml(s.notifications.ntfyTopic)}" />
                </div>
                <div class="form-group">
                  <label class="form-label">Token ntfy (optionnel, évite la limite 429)</label>
                  <input type="password" id="cfg-ntfy-token" class="form-control" placeholder="${s.notifications.hasNtfyToken ? "Token enregistré (chiffré)" : "tk_... (ntfy.sh/app → Account)"}" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">URL publique du site</label>
                  <input type="text" id="cfg-public-url" class="form-control" value="${escapeHtml(s.publicUrl || "")}" placeholder="https://mon-site.fr" />
                </div>
                <div class="form-group">
                  <label class="form-label">Webhook Discord / Slack (facultatif)</label>
                  <input type="url" id="cfg-webhook-url" class="form-control" value="${escapeHtml(s.notifications.webhookUrl || "")}" placeholder="https://discord.com/api/webhooks/..." />
                </div>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                <button type="button" class="btn btn-secondary btn-xs" id="btn-test-phone-push">
                  🚨 Envoyer une alerte URGENTE de test sur mon iPhone
                </button>
                <a class="btn btn-secondary btn-xs" href="ntfy://ntfy.sh/${encodeURIComponent(s.notifications.ntfyTopic || "")}">
                  📲 Ouvrir dans ntfy
                </a>
              </div>
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

        <div class="integration-panel highlight-integration">
          <div class="integration-head-inline">
            <div>
              <span class="legal-tag">Google Gemini • Économie API</span>
              <h2>🤖 Assistant IA Gemini — Relais Automatique (1 min)</h2>
            </div>
            <label class="inline-check-pill">
              <input type="checkbox" id="cfg-ai-enabled" ${s.ai?.enabled !== false ? "checked" : ""} />
              <span>Activer le relais IA</span>
            </label>
          </div>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">
            Au début d'une conversation, un message <strong>non-IA</strong> (0 crédit) avertit le client qu'un conseiller humain a été alerté. Si vous ne répondez pas sous 60 secondes, l'IA prend automatiquement le relais jusqu'à ce que vous cliquiez sur <strong>« Reprendre le relais »</strong>.
          </p>
          ${
            !s.ai?.hasApiKey
              ? `<div class="fraud-reasons-alert" style="margin-bottom:0.75rem;">⚠️ <strong>Clé API Gemini non configurée sur ce serveur !</strong> Collez votre clé ci-dessous puis cliquez sur <em>Enregistrer toute la configuration</em> pour activer les réponses IA en ligne.</div>`
              : s.ai?.lastError
              ? `<div class="fraud-reasons-alert" style="margin-bottom:0.75rem;">⚠️ Dernière erreur Gemini : ${escapeHtml(s.ai.lastError)}</div>`
              : ""
          }
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Clé API Gemini (chiffrée AES-256)</label>
              <input type="password" id="cfg-ai-key" class="form-control" value="${escapeHtml(s.ai?.apiKeyPreview || "")}" placeholder="${s.ai?.hasApiKey ? "Clé enregistrée (chiffrée)" : "Collez votre clé Gemini (AQ.... ou AIza...)"}" />
            </div>
            <div class="form-group">
              <label class="form-label">Modèle Gemini</label>
              <input type="text" id="cfg-ai-model" class="form-control" value="${escapeHtml(s.ai?.model || "gemini-flash-lite-latest")}" placeholder="gemini-flash-lite-latest" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Délai avant prise de relais IA (secondes)</label>
              <input type="number" id="cfg-ai-delay" min="5" max="600" class="form-control" value="${Number(s.ai?.delaySeconds) || 60}" />
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end;">
              <button type="button" class="btn btn-secondary btn-xs" id="btn-test-ai">
                ✨ Tester la connexion Gemini maintenant
              </button>
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
              <label class="form-label">Identifiant de connexion Admin</label>
              <input type="text" id="cfg-admin-email" class="form-control" value="${escapeHtml(adminInfo.email)}" />
            </div>
            <div class="form-group">
              <label class="form-label">Changer le mot de passe Admin (min. 8 caractères)</label>
              <input type="password" id="cfg-admin-newpass" class="form-control" placeholder="Nouveau mot de passe fort" />
            </div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary" style="align-self:flex-start;">
          ✓ Enregistrer toute la configuration
        </button>
      </form>

      <!-- Liste Noire & Journal de Sécurité Anti-Fraude -->
      <div class="integration-panel" style="margin-top:1.15rem;">
        <div class="integration-head-inline">
          <h2>🛡️ Liste Noire Anti-Fraude &amp; Journal Sécurité</h2>
          ${
            (securityInfo?.blockedHashesCount || 0) + (securityInfo?.blockedFingerprintsCount || 0) > 0
              ? `<button type="button" class="btn btn-outline btn-xs" id="btn-clear-blocked-hashes">Vider les empreintes bloquées (${(securityInfo?.blockedHashesCount || 0) + (securityInfo?.blockedFingerprintsCount || 0)})</button>`
              : ""
          }
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);">
          Bloqués : <strong>${blockedEmails.length} e-mail(s)</strong> • <strong>${securityInfo?.blockedHashesCount || 0} réseau(x)</strong> • <strong>${securityInfo?.blockedFingerprintsCount || 0} appareil(s)</strong>
        </p>
        ${
          blockedEmails.length > 0
            ? `
            <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
              ${blockedEmails
                .map(
                  (em) => `
                  <span class="diag-badge diag-fraud">
                    🚫 ${escapeHtml(em)}
                    <button type="button" class="flag-dismiss-x" data-unblock-email="${escapeHtml(em)}" aria-label="Débloquer ${escapeHtml(em)}">×</button>
                  </span>
                `
                )
                .join("")}
            </div>
          `
            : ""
        }
        ${
          secEvents.length > 0
            ? `
            <div class="journey-timeline" style="margin-top:0.5rem;">
              <strong>Derniers événements de sécurité bloqués :</strong>
              <ul>
                ${secEvents
                  .slice(0, 8)
                  .map(
                    (ev) => `
                    <li>
                      <span class="tl-time">${new Date(ev.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <code class="tl-type">${escapeHtml(ev.type)}</code>
                      <span class="tl-label">${escapeHtml(ev.email || ev.visitorKey || "")} ${ev.score ? `(Score ${ev.score}/100)` : ""}</span>
                    </li>
                  `
                  )
                  .join("")}
              </ul>
            </div>
          `
            : ""
        }
      </div>
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
    const discScroll = container.querySelector("#admin-disc-scroll");
    if (discScroll) discScroll.scrollTop = discScroll.scrollHeight;

    // Discussions Filter & Thread Selection
    container.querySelectorAll("[data-disc-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.discFilter = btn.getAttribute("data-disc-filter");
        this.mobileDetailOpen = false;
        this.render();
      });
    });

    container.querySelector("#btn-admin-back-threads")?.addEventListener("click", () => {
      this.mobileDetailOpen = false;
      this.render();
    });

    // Geste tactile swipe-droite pour revenir à la liste des discussions sur mobile
    const detailPane = container.querySelector(".admin-disc-detail-pane");
    if (detailPane && this.mobileDetailOpen) {
      let sx = 0;
      let sy = 0;
      detailPane.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches.length === 1) {
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
          }
        },
        { passive: true }
      );
      detailPane.addEventListener(
        "touchend",
        (e) => {
          if (!e.changedTouches.length) return;
          const dx = e.changedTouches[0].clientX - sx;
          const dy = e.changedTouches[0].clientY - sy;
          if (sx < 48 && dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) {
            this.mobileDetailOpen = false;
            this.render();
          }
        },
        { passive: true }
      );
    }

    container.querySelectorAll("[data-select-thread]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-select-thread");
        this.selectedThreadId = tid;
        this.mobileDetailOpen = true;
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/read`, {
          method: "POST",
          headers: this.authHeaders()
        }).catch(() => {});
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Contrôle Relais Humain ↔ IA ("Reprendre le relais" / "Perdre le relais")
    container.querySelectorAll("[data-relay-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-relay-action");
        const tid = btn.getAttribute("data-relay-thread");
        btn.disabled = true;
        const resp = await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/relay`, {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({ action })
        });
        if (resp.ok) {
          showToast(
            action === "take_human"
              ? "👤 Vous avez repris le relais : l'IA est mise en pause."
              : "🤖 Relais cédé à l'IA Gemini !",
            "info"
          );
          await this.refreshDashboardSilently();
          this.render({ preserveChatDraft: true });
        } else {
          btn.disabled = false;
          showToast("Impossible de changer le relais.", "error");
        }
      });
    });

    // Dossiers Admin events
    container.querySelectorAll("[data-dossier-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.dossierFilter = btn.getAttribute("data-dossier-filter");
        this.mobileDossierDetailOpen = false;
        this.render();
      });
    });

    container.querySelector("#admin-dossier-search")?.addEventListener("input", (e) => {
      this.dossierSearch = e.target.value || "";
      this.render();
      const inp = document.getElementById("admin-dossier-search");
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    });

    container.querySelector("#btn-admin-back-dossiers")?.addEventListener("click", () => {
      this.mobileDossierDetailOpen = false;
      this.render();
    });

    container.querySelectorAll("[data-select-dossier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedDossierId = btn.getAttribute("data-select-dossier");
        this.mobileDossierDetailOpen = true;
        this.adminRevealDossierSecrets = false;
        this.render();
      });
    });

    container.querySelectorAll("[data-select-dossier-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.dossierFilter = "all";
        this.selectedDossierId = btn.getAttribute("data-select-dossier-jump");
        this.mobileDossierDetailOpen = true;
        this.render();
      });
    });

    container.querySelectorAll("[data-open-thread-from-dossier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = btn.getAttribute("data-open-thread-from-dossier");
        this.selectedThreadId = tid;
        this.mobileDetailOpen = true;
        this.activeTab = "discussions";
        this.render();
      });
    });

    container.querySelector("#btn-toggle-dossier-secrets")?.addEventListener("click", () => {
      this.adminRevealDossierSecrets = !this.adminRevealDossierSecrets;
      this.render();
    });

    container.querySelector("#btn-export-dossier")?.addEventListener("click", (e) => {
      const oid = e.currentTarget.getAttribute("data-export-order");
      const dos = (this.dashboard?.dossiers || []).find((x) => x.orderId === oid);
      if (dos) this.exportDossierTxt(dos);
    });

    container.querySelector("#admin-dossier-update-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const oid = form.getAttribute("data-dossier-order");
      const resp = await fetch(`/api/admin/dossiers/${encodeURIComponent(oid)}`, {
        method: "PATCH",
        headers: this.authHeaders(),
        body: JSON.stringify({
          dossierStatus: form.elements.dossierStatus.value,
          phone: form.elements.phone.value,
          recoveredContact: form.elements.recoveredContact.value,
          dossierNotes: form.elements.dossierNotes.value
        })
      });
      if (resp.ok) {
        showToast("Dossier mis à jour et sauvegardé !", "success");
        await this.refreshDashboardSilently();
        this.render();
      } else {
        showToast("Erreur lors de la sauvegarde du dossier.", "error");
      }
    });

    container.querySelectorAll("[data-link-claim]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const claimId = btn.getAttribute("data-link-claim");
        const orderId = btn.getAttribute("data-link-order");
        const resp = await fetch("/api/admin/dossiers/link-claim", {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({ claimId, orderId })
        });
        if (resp.ok) {
          showToast(`Signalement #${claimId} rattaché au dossier #${orderId} !`, "success");
          this.dossierFilter = "all";
          this.selectedDossierId = orderId;
          this.mobileDossierDetailOpen = true;
          await this.refreshDashboardSilently();
          this.render();
        }
      });
    });

    container.querySelectorAll("[data-link-claim-select]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const claimId = btn.getAttribute("data-link-claim-select");
        const sel = container.querySelector(`#manual-link-sel-${claimId}`);
        const orderId = sel?.value;
        if (!orderId) return;
        const resp = await fetch("/api/admin/dossiers/link-claim", {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({ claimId, orderId })
        });
        if (resp.ok) {
          showToast(`Signalement #${claimId} rattaché au dossier #${orderId} !`, "success");
          this.dossierFilter = "all";
          this.selectedDossierId = orderId;
          this.mobileDossierDetailOpen = true;
          await this.refreshDashboardSilently();
          this.render();
        }
      });
    });

    // Flags précis (toggle individuel, status, ou reset Auto)
    container.querySelectorAll("[data-flag-thread]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-flag-thread");
        const key = btn.getAttribute("data-flag-key");
        const flagId = btn.getAttribute("data-flag-id");
        const rawVal = btn.getAttribute("data-flag-val");
        const val = rawVal === "true" ? true : rawVal === "false" ? false : rawVal === "auto" ? null : rawVal;

        const payload = flagId ? { flagId, flagValue: val } : { [key]: val };
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/flags`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify(payload)
        });
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Note privée admin sur discussion
    container.querySelectorAll("[data-note-thread]").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const tid = form.getAttribute("data-note-thread");
        const adminNotes = form.elements.adminNotes?.value || "";
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/flags`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify({ adminNotes })
        });
        showToast("Note privée enregistrée.", "success");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Whitelist Fiable depuis discussion
    container.querySelectorAll("[data-trust-client]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-trust-client");
        const val = btn.getAttribute("data-trust-val") === "true";
        await fetch(`/api/admin/discussions/${encodeURIComponent(tid)}/flags`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify({ trustClient: val })
        });
        showToast(val ? "Client marqué comme fiable (Whitelist)." : "Whitelist retirée.", "info");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Block / Unblock client depuis discussion
    container.querySelectorAll("[data-block-client]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.getAttribute("data-block-client");
        const shouldBlock = btn.getAttribute("data-block-val") === "true";
        if (shouldBlock && !confirm("Bloquer cet e-mail, cette connexion réseau, cet appareil et suspendre le compte associé ?")) {
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

    container.querySelectorAll("[data-admin-quick]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const inp = container.querySelector("#admin-disc-reply-input");
        if (inp) {
          inp.value = chip.getAttribute("data-admin-quick") || "";
          inp.focus();
        }
      });
    });

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

    // Clients & Anti-Fraude events
    container.querySelectorAll("[data-cust-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.customerFilter = btn.getAttribute("data-cust-filter");
        this.render();
      });
    });

    container.querySelector("#admin-cust-search")?.addEventListener("input", (e) => {
      this.customerSearch = e.target.value || "";
      this.render();
      const inp = document.getElementById("admin-cust-search");
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    });

    container.querySelectorAll("[data-customer-note]").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const uid = form.getAttribute("data-customer-note");
        const adminNotes = form.elements.adminNotes?.value || "";
        await fetch(`/api/admin/customers/${encodeURIComponent(uid)}`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify({ adminNotes })
        });
        showToast("Note client enregistrée.", "success");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    container.querySelectorAll("[data-cust-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.getAttribute("data-cust-id");
        const action = btn.getAttribute("data-cust-action");
        const rawVal = btn.getAttribute("data-val");
        let payload = {};
        if (action === "trust") payload = { trustedOverride: rawVal === "true" };
        else if (action === "flag-vip") payload = { flagId: "vip_loyal", flagValue: rawVal === "true" };
        else if (action === "status") payload = { status: rawVal };
        else if (action === "block") {
          const shouldBlock = rawVal === "true";
          if (shouldBlock && !confirm("Suspendre ce compte et bloquer son e-mail, réseau et appareil ?")) return;
          payload = { blockClient: shouldBlock };
        }
        await fetch(`/api/admin/customers/${encodeURIComponent(uid)}`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify(payload)
        });
        showToast("Statut client mis à jour.", "success");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    container.querySelectorAll("[data-block-visitor]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.getAttribute("data-block-visitor");
        if (!confirm("Bloquer définitivement la connexion et l'appareil de ce visiteur ?")) return;
        await fetch(`/api/admin/visitors/${encodeURIComponent(key)}/block`, {
          method: "POST",
          headers: this.authHeaders()
        });
        showToast("Visiteur bloqué par l'anti-fraude.", "info");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    // Security unblock actions
    container.querySelectorAll("[data-unblock-email]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.getAttribute("data-unblock-email");
        await fetch("/api/admin/security/unblock", {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({ email })
        });
        showToast(`${email} débloqué.`, "info");
        await this.refreshDashboardSilently();
        this.render();
      });
    });

    container.querySelector("#btn-clear-blocked-hashes")?.addEventListener("click", async () => {
      if (!confirm("Réinitialiser toutes les empreintes réseau et appareil bloquées ?")) return;
      await fetch("/api/admin/security/unblock", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ clearAllHashes: true })
      });
      showToast("Empreintes bloquées effacées.", "info");
      await this.refreshDashboardSilently();
      this.render();
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

    // Test connexion IA Gemini
    container.querySelector("#btn-test-ai")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const apiKey = container.querySelector("#cfg-ai-key")?.value || "";
      const model = container.querySelector("#cfg-ai-model")?.value || "";
      try {
        const resp = await fetch("/api/admin/test-ai", {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({ apiKey, model })
        });
        const data = await resp.json();
        if (data.ok) {
          showToast(`🤖 Gemini OK (${data.model} • ${data.latencyMs}ms) : ${data.text.slice(0, 90)}`, "success", 5500);
        } else {
          showToast(`Erreur Gemini : ${data.error || "échec"}`, "error", 5500);
        }
      } catch {
        showToast("Erreur réseau lors du test Gemini.", "error");
      } finally {
        btn.disabled = false;
      }
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
      if (data.pushRes?.bark || data.pushRes?.ntfy || data.pushRes?.webhook) {
        const channels = [
          data.pushRes.bark ? "Bark iPhone" : "",
          data.pushRes.ntfy ? "ntfy" : "",
          data.pushRes.webhook ? "Webhook" : ""
        ].filter(Boolean).join(" + ");
        showToast(`🚨 Notification urgente envoyée (${channels}) !`, "success");
      } else {
        showToast(`Info : ${data.pushRes?.errors?.join(" • ") || "Configurez Bark iPhone ou ntfy ci-dessus"}`, "info");
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
          barkEnabled: container.querySelector("#cfg-bark-enabled").checked,
          barkUrl: container.querySelector("#cfg-bark-url").value,
          barkSound: container.querySelector("#cfg-bark-sound").value,
          barkCritical: container.querySelector("#cfg-bark-critical").checked,
          ntfyEnabled: container.querySelector("#cfg-ntfy-enabled").checked,
          ntfyTopic: container.querySelector("#cfg-ntfy-topic").value,
          ntfyToken: container.querySelector("#cfg-ntfy-token").value,
          webhookUrl: container.querySelector("#cfg-webhook-url").value,
          smtp: {
            enabled: container.querySelector("#cfg-smtp-enabled").checked,
            user: container.querySelector("#cfg-smtp-user").value,
            pass: container.querySelector("#cfg-smtp-pass").value
          }
        },
        ai: {
          enabled: container.querySelector("#cfg-ai-enabled").checked,
          apiKey: container.querySelector("#cfg-ai-key").value,
          model: container.querySelector("#cfg-ai-model").value,
          delaySeconds: Number(container.querySelector("#cfg-ai-delay").value) || 60
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
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        showToast("Configuration enregistrée et chiffrée !", "success");
        await store.initBootstrap();
        await this.refreshDashboardSilently();
        this.render();
      } else {
        showToast(data.error || "Erreur lors de l'enregistrement de la configuration.", "error");
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
          ${renderFraudAnalyticsPanel(order.fraudAssessment, {
            openByDefault: (order.riskScore || 0) >= 40,
            compactTitle: "🔬 Vérification Anti-Fraude avant livraison"
          })}
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
            ${(order.messages || []).map((m) => renderAdminChatBubble(m, order.customerName)).join("")}
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
