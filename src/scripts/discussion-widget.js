/**
 * Boîte de Dialogue Complète de Discussion Client (#discussion-dialog) :
 * - Plein écran ergonomique sur mobile (aucune obstruction par les suggestions ou formulaires)
 * - Support complet du Relais Humain ↔ IA Gemini (messages thématisés + compteur temps réel)
 * - Gestion dynamique du clavier virtuel mobile via window.visualViewport
 */

import { store } from "./store.js";
import { closeDialogSmoothly, showToast, playChime, escapeHtml } from "./mwg-helpers.js";
import { account } from "./account.js";
import { siteTracker } from "./site-tracker.js";

const SAVED_THREAD_KEY = "nexus_customer_discussion_v1";

let activeThread = null;
let activeToken = "";
let selectedTopic = "general"; // 'general' | 'rescue' | productId
let discussionSse = null;
let metaExpanded = false;
let suggestionsOpen = false;
let countdownTimer = null;
let viewportBound = false;

function loadSavedThreadRef() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_THREAD_KEY) || "null");
  } catch {
    return null;
  }
}

function saveThreadRef(threadId, threadToken) {
  try {
    localStorage.setItem(SAVED_THREAD_KEY, JSON.stringify({ threadId, threadToken }));
  } catch {
    // ignore
  }
}

function updateFloatingUnreadBadge(count) {
  const badge = document.getElementById("floating-chat-unread");
  if (!badge) return;
  badge.textContent = String(count);
  badge.classList.toggle("hidden", !count || count <= 0);
}

function formatRelayCountdown(relayDueAt) {
  if (!relayDueAt) return "";
  const remSec = Math.max(0, Math.ceil((new Date(relayDueAt).getTime() - Date.now()) / 1000));
  if (remSec <= 0) return "Relais IA imminent…";
  return `Relais IA dans ${remSec}s`;
}

function syncVisualViewportHeight() {
  const dialog = document.getElementById("discussion-dialog");
  if (!dialog?.open) return;
  const vv = window.visualViewport;
  if (vv && window.innerWidth <= 768) {
    dialog.style.setProperty("--disc-vvh", `${Math.round(vv.height)}px`);
    const scroller = document.getElementById("disc-messages-scroll");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  } else {
    dialog.style.removeProperty("--disc-vvh");
  }
}

function startCountdownLoop() {
  if (countdownTimer) return;
  countdownTimer = setInterval(() => {
    const dialog = document.getElementById("discussion-dialog");
    if (!dialog?.open) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      return;
    }
    const ctrl = activeThread?.aiControl;
    if (ctrl?.mode === "waiting_human" && ctrl.relayDueAt) {
      const txt = formatRelayCountdown(ctrl.relayDueAt);
      document.querySelectorAll("[data-relay-countdown]").forEach((el) => {
        el.textContent = txt;
      });
    }
  }, 1000);
}

export async function initCustomerDiscussionWidget() {
  const saved = loadSavedThreadRef();
  if (saved?.threadId && saved?.threadToken) {
    activeToken = saved.threadToken;
    try {
      const resp = await fetch(
        `/api/discussions/${encodeURIComponent(saved.threadId)}?token=${encodeURIComponent(saved.threadToken)}`
      );
      if (resp.ok) {
        const data = await resp.json();
        activeThread = data.thread;
        connectDiscussionStream(activeThread.threadId, activeToken);
      }
    } catch {
      // ignore offline startup
    }
  }

  const dialog = document.getElementById("discussion-dialog");
  if (dialog && !viewportBound) {
    viewportBound = true;
    dialog.addEventListener("close", () => {
      dialog.style.removeProperty("--disc-vvh");
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncVisualViewportHeight);
    }
    window.addEventListener("resize", syncVisualViewportHeight);
  }

  window.openCustomerDiscussion = openCustomerDiscussion;
}

function connectDiscussionStream(threadId, token) {
  if (discussionSse) {
    discussionSse.close();
    discussionSse = null;
  }
  try {
    const es = new EventSource(
      `/api/events/discussion/${encodeURIComponent(threadId)}?token=${encodeURIComponent(token)}`
    );
    es.addEventListener("new_message", (e) => {
      const payload = JSON.parse(e.data);
      const prevCount = activeThread?.messages?.length || 0;
      activeThread = payload.thread;
      const last = activeThread.messages?.[activeThread.messages.length - 1];
      const dialog = document.getElementById("discussion-dialog");

      const isIncoming =
        activeThread.messages.length > prevCount &&
        (last?.sender === "admin" || last?.sender === "ai" || last?.sender === "relay");

      if (isIncoming) {
        if (last?.sender === "admin" || last?.sender === "ai") {
          playChime("success");
        }
        if (dialog?.open) {
          renderDiscussionDialog({ preserveInput: true });
        } else if (last?.sender === "admin" || last?.sender === "ai") {
          updateFloatingUnreadBadge(
            (parseInt(document.getElementById("floating-chat-unread")?.textContent || "0", 10) || 0) + 1
          );
          showToast(
            last.sender === "ai"
              ? "🤖 Réponse de l'assistant IA NEXUS ! Cliquez sur Discuter."
              : "💬 Nouvelle réponse du conseiller NEXUS ! Cliquez sur Discuter.",
            "info",
            5500
          );
        }
      } else if (dialog?.open) {
        renderDiscussionDialog({ preserveInput: true });
      }
    });
    es.addEventListener("discussion_updated", (e) => {
      const payload = JSON.parse(e.data);
      activeThread = payload.thread;
      const dialog = document.getElementById("discussion-dialog");
      if (dialog?.open) renderDiscussionDialog({ preserveInput: true });
    });
    discussionSse = es;
  } catch {
    // ignore
  }
}

export async function openCustomerDiscussion({ productId = null, topic = null, resumeThread = null, resumeToken = null } = {}) {
  const dialog = document.getElementById("discussion-dialog");
  if (!dialog) return;

  updateFloatingUnreadBadge(0);
  metaExpanded = false;
  suggestionsOpen = false;

  if (resumeThread && resumeToken) {
    activeThread = resumeThread;
    activeToken = resumeToken;
    saveThreadRef(resumeThread.threadId, resumeToken);
    connectDiscussionStream(resumeThread.threadId, resumeToken);
  }

  if (productId) {
    selectedTopic = productId;
  } else if (topic) {
    selectedTopic = topic;
  } else if (activeThread?.productId) {
    selectedTopic = activeThread.productId;
  } else {
    selectedTopic = "general";
  }

  if (activeThread && activeToken && (productId || topic)) {
    const isProd = store.getProductById(selectedTopic);
    fetch(`/api/discussions/${encodeURIComponent(activeThread.threadId)}/context`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: activeToken,
        topicType: selectedTopic === "rescue" ? "rescue" : isProd ? "product" : "general",
        productId: isProd ? isProd.id : null
      })
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.thread) {
          activeThread = d.thread;
          renderDiscussionDialog({ preserveInput: true });
        }
      })
      .catch(() => {});
  }

  renderDiscussionDialog();
  siteTracker.track("discussion_open", selectedTopic);
  if (!dialog.open) dialog.showModal();
  syncVisualViewportHeight();
  startCountdownLoop();
}

function getQuickQuestionsForTopic(topicVal) {
  const prod = store.getProductById(topicVal);
  if (topicVal === "rescue") {
    return [
      "J'ai perdu l'accès à mon abonnement acheté.",
      "J'ai effectué mon paiement mais ma page s'est fermée.",
      "J'ai fait une erreur dans mon adresse e-mail lors de l'achat."
    ];
  }
  if (prod) {
    return [
      `L'offre ${prod.title} (${prod.price} €) est-elle disponible immédiatement ?`,
      `Comment fonctionne l'activation pour ${prod.title} ?`,
      `Y a-t-il une garantie 12 mois sur ${prod.title} ?`
    ];
  }
  return [
    "Sous combien de temps vais-je recevoir mes accès ?",
    "J'ai perdu mon accès ou mon numéro de commande",
    "Comment fonctionne votre Garantie 365 jours ?"
  ];
}

function getTopicSummaryText(focusedProduct) {
  if (selectedTopic === "rescue") return "🛡️ Urgence / Bien perdu";
  if (focusedProduct) return `📦 ${focusedProduct.title} (${focusedProduct.price} €)`;
  return "🌐 Question générale";
}

function renderRelayStatusPill(thread) {
  const ctrl = thread?.aiControl;
  if (!ctrl) {
    return `<span class="live-sync-pill"><span class="sync-dot"></span>Support 7j/7</span>`;
  }
  if (ctrl.mode === "waiting_human") {
    return `<span class="live-sync-pill pill-relay-waiting"><span class="sync-dot"></span><span data-relay-countdown>${escapeHtml(formatRelayCountdown(ctrl.relayDueAt))}</span></span>`;
  }
  if (ctrl.mode === "ai_active") {
    return `<span class="live-sync-pill pill-relay-ai">🤖 IA en relais</span>`;
  }
  return `<span class="live-sync-pill pill-relay-human">👤 Conseiller actif</span>`;
}

function renderMessageBubble(m) {
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

  const who =
    m.sender === "admin"
      ? "👤 Conseiller NEXUS"
      : m.sender === "ai"
      ? "🤖 Assistant IA NEXUS"
      : m.sender === "relay"
      ? m.relayEvent === "human_takeover"
        ? "👤 REPRISE HUMAINE"
        : m.relayEvent === "ai_takeover" || m.relayEvent === "ai_resume"
        ? "🤖 RELAIS IA ACTIVÉ"
        : "📩 ASSISTANCE HUMAINE DEMANDÉE"
      : m.sender === "customer"
      ? "Vous"
      : "Information";

  const time = new Date(m.createdAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  let attachHtml = "";
  if (m.attachment?.type === "product") {
    attachHtml = `
      <div class="chat-attached-card">
        <div>
          <strong>📦 ${escapeHtml(m.attachment.title)}</strong>
          <span>${escapeHtml(m.attachment.duration)} • <strong>${m.attachment.price} €</strong></span>
        </div>
        <button type="button" class="btn btn-primary btn-xs" data-disc-buy="${escapeHtml(m.attachment.id)}">Acheter</button>
      </div>
    `;
  } else if (m.attachment?.type === "coupon") {
    attachHtml = `
      <div class="chat-attached-card">
        <div>
          <strong>🏷️ Code Promo : <code>${escapeHtml(m.attachment.code)}</code></strong>
          <span>${escapeHtml(m.attachment.label)}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-xs" data-copy-chat-coupon="${escapeHtml(m.attachment.code)}">Copier</button>
      </div>
    `;
  }

  return `
    <div class="chat-bubble ${cls}">
      <div class="chat-bubble-meta">
        <strong>${escapeHtml(who)}</strong>
        <span>${time}</span>
      </div>
      ${m.text ? `<div class="chat-bubble-text">${escapeHtml(m.text)}</div>` : ""}
      ${attachHtml}
    </div>
  `;
}

function renderDiscussionDialog({ preserveInput = false } = {}) {
  const dialog = document.getElementById("discussion-dialog");
  const container = document.getElementById("discussion-dialog-content");
  if (!dialog || !container) return;

  const draftMsg = preserveInput ? container.querySelector("#disc-message-input")?.value || "" : "";
  const draftName = preserveInput ? container.querySelector("#disc-customer-name")?.value : undefined;
  const draftEmail = preserveInput ? container.querySelector("#disc-customer-email")?.value : undefined;

  const products = store.products || [];
  const focusedProduct = store.getProductById(selectedTopic);
  const quickQuestions = getQuickQuestionsForTopic(selectedTopic);
  const hasMessages = Boolean(activeThread?.messages?.length);

  const resolvedName =
    draftName !== undefined
      ? draftName
      : activeThread?.customerName && activeThread.customerName !== "Visiteur"
      ? activeThread.customerName
      : account.authenticated && account.user
      ? account.user.name
      : "";
  const resolvedEmail =
    draftEmail !== undefined
      ? draftEmail
      : activeThread?.customerEmail || (account.authenticated && account.user ? account.user.email : "");

  container.innerHTML = `
    <div class="checkout-header disc-modal-header">
      <div class="checkout-header-title">
        <div class="live-pulse-badge" aria-hidden="true">💬</div>
        <div>
          <div class="live-order-title-row">
            <h1 id="discussion-dialog-title" class="checkout-title">Discussion NEXUS</h1>
            ${renderRelayStatusPill(activeThread)}
          </div>
          <p class="checkout-subtitle">Posez vos questions • Relais conseiller humain &amp; assistant IA 7j/7</p>
        </div>
      </div>
      <div class="header-dialog-btns">
        <button
          type="button"
          class="btn btn-outline btn-xs disc-meta-header-toggle"
          id="btn-toggle-disc-meta-hdr"
          aria-expanded="${metaExpanded}"
          title="Sujet et coordonnées"
        >⚙️</button>
        ${
          activeThread
            ? `<button type="button" class="btn btn-outline btn-xs" id="btn-new-disc-thread" title="Démarrer un nouveau sujet">Nouveau</button>`
            : ""
        }
        <button type="button" class="btn-close-dialog" data-close-disc aria-label="Fermer la discussion">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="disc-dialog-body">
      <!-- Barre résumé compacte sur mobile (évite toute obstruction du chat) -->
      <button type="button" class="disc-mobile-meta-bar" id="btn-toggle-disc-meta" aria-expanded="${metaExpanded}">
        <span class="disc-mobile-meta-summary">${escapeHtml(getTopicSummaryText(focusedProduct))}${resolvedName ? ` • ${escapeHtml(resolvedName)}` : ""}</span>
        <span class="disc-mobile-meta-action">${metaExpanded ? "Masquer ▲" : "Sujet / Infos ▾"}</span>
      </button>

      <!-- Panneau Sujet & Coordonnées (replié par défaut sur mobile, visible sur PC) -->
      <div class="disc-meta-collapsible ${metaExpanded ? "is-open" : ""}">
        <div class="disc-topic-bar">
          <label for="disc-topic-select" class="form-label">Sujet de votre discussion :</label>
          <div class="disc-topic-controls">
            <select id="disc-topic-select" class="form-control">
              <option value="general" ${selectedTopic === "general" ? "selected" : ""}>🌐 Tous les articles / Question générale</option>
              <optgroup label="Parler d'un article précis :">
                ${products
                  .map(
                    (p) => `
                    <option value="${escapeHtml(p.id)}" ${selectedTopic === p.id ? "selected" : ""}>
                      📦 ${escapeHtml(p.title)} — ${p.price} € (${p.availability === "out_of_stock" ? "Rupture" : "En stock"})
                    </option>
                  `
                  )
                  .join("")}
              </optgroup>
              <option value="rescue" ${selectedTopic === "rescue" ? "selected" : ""}>🛡️ Urgence Paiement / Bien perdu</option>
            </select>

            ${
              focusedProduct
                ? `
                  <div class="disc-focused-product-chip">
                    <span><strong>${escapeHtml(focusedProduct.title)}</strong> • ${focusedProduct.price} €</span>
                    ${
                      store.isProductAvailable(focusedProduct)
                        ? `<button type="button" class="btn btn-primary btn-xs" data-disc-buy="${escapeHtml(focusedProduct.id)}">Commander</button>`
                        : `<span class="stock-pill stock-out">Indisponible</span>`
                    }
                  </div>
                `
                : ""
            }
          </div>
        </div>

        <div class="disc-identity-bar">
          <div class="form-group">
            <label for="disc-customer-name" class="visually-hidden">Votre prénom</label>
            <input
              type="text"
              id="disc-customer-name"
              class="form-control form-control-sm"
              placeholder="Votre prénom (ex: Léa)"
              value="${escapeHtml(resolvedName)}"
            />
          </div>
          <div class="form-group">
            <label for="disc-customer-email" class="visually-hidden">Votre e-mail (facultatif)</label>
            <input
              type="email"
              id="disc-customer-email"
              class="form-control form-control-sm"
              placeholder="Votre e-mail (facultatif, pour suivi)"
              value="${escapeHtml(resolvedEmail)}"
            />
          </div>
        </div>
      </div>

      <!-- Zone de messages plein écran -->
      <div class="disc-messages-viewport" id="disc-messages-scroll">
        ${
          !hasMessages
            ? `
              <div class="disc-welcome-empty">
                <p><strong>Bonjour 👋 Comment pouvons-nous vous aider ?</strong></p>
                <p>Écrivez votre message ci-dessous : un conseiller humain est alerté immédiatement (et l'assistant IA prend le relais sous 1 min s'il est occupé).</p>
              </div>
            `
            : activeThread.messages.map(renderMessageBubble).join("")
        }
      </div>

      <!-- Tiroir de questions rapides uniquement à la demande (bouton 💡) -->
      ${
        suggestionsOpen
          ? `
            <div class="disc-suggestions-drawer" id="disc-suggestions-drawer">
              ${quickQuestions
                .map(
                  (q) => `<button type="button" class="quick-prompt-chip sm" data-quick-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
                )
                .join("")}
            </div>
          `
          : ""
      }

      <!-- Barre de saisie collée en bas -->
      <form id="disc-send-form" class="disc-input-bar">
        <input type="text" name="website_hp" class="visually-hidden" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <button
          type="button"
          id="btn-toggle-disc-suggest"
          class="btn-disc-suggest-toggle ${suggestionsOpen ? "active" : ""}"
          aria-expanded="${suggestionsOpen}"
          title="Afficher / masquer les questions rapides"
          aria-label="Afficher les questions rapides"
        >💡</button>
        <label for="disc-message-input" class="visually-hidden">Votre message</label>
        <input
          type="text"
          id="disc-message-input"
          class="form-control"
          placeholder="Écrivez votre message..."
          value="${escapeHtml(draftMsg)}"
          autocomplete="off"
          required
        />
        <button type="submit" id="btn-disc-send" class="btn btn-primary">
          <span>Envoyer</span>
        </button>
      </form>
    </div>
  `;

  const msgViewport = container.querySelector("#disc-messages-scroll");
  if (msgViewport) msgViewport.scrollTop = msgViewport.scrollHeight;

  container.querySelector("[data-close-disc]")?.addEventListener("click", () => closeDialogSmoothly(dialog));

  const toggleMeta = () => {
    metaExpanded = !metaExpanded;
    renderDiscussionDialog({ preserveInput: true });
  };
  container.querySelector("#btn-toggle-disc-meta")?.addEventListener("click", toggleMeta);
  container.querySelector("#btn-toggle-disc-meta-hdr")?.addEventListener("click", toggleMeta);

  container.querySelector("#btn-toggle-disc-suggest")?.addEventListener("click", () => {
    suggestionsOpen = !suggestionsOpen;
    renderDiscussionDialog({ preserveInput: true });
  });

  container.querySelector("#btn-new-disc-thread")?.addEventListener("click", () => {
    activeThread = null;
    activeToken = "";
    suggestionsOpen = false;
    localStorage.removeItem(SAVED_THREAD_KEY);
    if (discussionSse) {
      discussionSse.close();
      discussionSse = null;
    }
    renderDiscussionDialog();
  });

  container.querySelector("#disc-topic-select")?.addEventListener("change", (e) => {
    selectedTopic = e.target.value;
    if (activeThread && activeToken) {
      const prod = store.getProductById(selectedTopic);
      fetch(`/api/discussions/${encodeURIComponent(activeThread.threadId)}/context`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: activeToken,
          topicType: selectedTopic === "rescue" ? "rescue" : prod ? "product" : "general",
          productId: prod ? prod.id : null
        })
      }).catch(() => {});
    }
    renderDiscussionDialog({ preserveInput: true });
  });

  container.querySelectorAll("[data-disc-buy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.getAttribute("data-disc-buy");
      const res = store.setBuyNowItem(pid);
      if (res.ok) {
        await closeDialogSmoothly(dialog);
        window.openCheckoutModal?.();
      } else {
        showToast(res.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-copy-chat-coupon]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-copy-chat-coupon");
      try {
        await navigator.clipboard.writeText(code);
        showToast(`Code « ${code} » copié !`, "success");
      } catch {
        showToast(code, "info");
      }
    });
  });

  container.querySelectorAll("[data-quick-q]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = container.querySelector("#disc-message-input");
      if (input) {
        input.value = chip.getAttribute("data-quick-q") || "";
        suggestionsOpen = false;
        container.querySelector("#disc-send-form")?.requestSubmit();
      }
    });
  });

  container.querySelector("#disc-send-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = container.querySelector("#disc-message-input");
    const text = input?.value.trim() || "";
    if (!text) return;

    const customerName = container.querySelector("#disc-customer-name")?.value.trim() || "";
    const customerEmail = container.querySelector("#disc-customer-email")?.value.trim() || "";
    const honeypot = container.querySelector('input[name="website_hp"]')?.value || "";

    const sendBtn = container.querySelector("#btn-disc-send");
    if (sendBtn) sendBtn.disabled = true;
    input.value = "";
    metaExpanded = false;
    suggestionsOpen = false;

    try {
      if (!activeThread || !activeToken) {
        const prod = store.getProductById(selectedTopic);
        const resp = await fetch("/api/discussions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            customerName,
            customerEmail,
            topicType: selectedTopic === "rescue" ? "rescue" : prod ? "product" : "general",
            productId: prod ? prod.id : "",
            initialMessage: text,
            honeypot,
            ...siteTracker.getPayloadMeta()
          })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Envoi impossible.");

        siteTracker.track("message_sent", selectedTopic, { ok: true });
        activeThread = data.thread;
        activeToken = data.threadToken;
        saveThreadRef(activeThread.threadId, activeToken);
        connectDiscussionStream(activeThread.threadId, activeToken);
        if (account.authenticated) account.fetchSession({ silent: true });
        renderDiscussionDialog();
        startCountdownLoop();
      } else {
        if (customerName || customerEmail) {
          await fetch(`/api/discussions/${encodeURIComponent(activeThread.threadId)}/context`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: activeToken, customerName, customerEmail })
          }).catch(() => {});
        }

        const resp = await fetch(`/api/discussions/${encodeURIComponent(activeThread.threadId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: activeToken, text })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Envoi impossible.");
        activeThread = data.thread;
        renderDiscussionDialog();
      }
    } catch (err) {
      input.value = text;
      showToast(err.message, "error");
      if (sendBtn) sendBtn.disabled = false;
    }
  });
}
