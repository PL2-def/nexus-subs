/**
 * Boîte de Dialogue Complète de Discussion Client (#discussion-dialog) :
 * - Accessible à tout moment via le bouton flottant en bas à droite, le menu ou une carte produit
 * - Permet de parler en général de tous les articles OU d'un article précis (avec aperçu prix/stock & achat 1-clic)
 * - Connectée en temps réel (SSE) au nouveau menu "Discussions" de l'Administrateur
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

      if (activeThread.messages.length > prevCount && last?.sender === "admin") {
        playChime("success");
        if (dialog?.open) {
          renderDiscussionDialog({ preserveInput: true });
        } else {
          updateFloatingUnreadBadge(( parseInt(document.getElementById("floating-chat-unread")?.textContent || "0", 10) || 0 ) + 1);
          showToast("💬 Nouvelle réponse du conseiller NEXUS ! Cliquez sur Discuter.", "info", 5500);
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

  // Si un fil existe déjà et que le client change d'article, mettre à jour le contexte côté serveur
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
}

function getQuickQuestionsForTopic(topicVal) {
  const prod = store.getProductById(topicVal);
  if (topicVal === "rescue") {
    return [
      "J'ai effectué mon paiement mais ma page s'est fermée.",
      "J'ai oublié de mettre la référence dans mon virement SEPA.",
      "J'ai fait une erreur dans mon adresse e-mail lors de l'achat."
    ];
  }
  if (prod) {
    return [
      `L'offre ${prod.title} (${prod.price} €) est-elle disponible immédiatement ?`,
      `Comment fonctionne l'activation pour ${prod.title} ?`,
      `Y a-t-il une garantie 12 mois sur ${prod.title} ?`,
      `Puis-je régler ${prod.title} par Stripe, PayPal ou SEPA ?`
    ];
  }
  return [
    "Bonjour ! Quelle différence entre vos offres et les abonnements mensuels ?",
    "Sous combien de temps vais-je recevoir mes accès après paiement ?",
    "Puis-je acheter plusieurs abonnements dans la même commande ?",
    "Comment fonctionne votre Garantie 365 jours ?"
  ];
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

  container.innerHTML = `
    <div class="checkout-header">
      <div class="checkout-header-title">
        <div class="live-pulse-badge" aria-hidden="true">💬</div>
        <div>
          <div class="live-order-title-row">
            <h1 id="discussion-dialog-title" class="checkout-title">Discussion en Direct avec NEXUS</h1>
            <span class="live-sync-pill"><span class="sync-dot"></span>Réponse rapide 7j/7</span>
          </div>
          <p class="checkout-subtitle">Posez vos questions sur toute la boutique ou sur un abonnement précis</p>
        </div>
      </div>
      <div class="header-dialog-btns">
        ${
          activeThread
            ? `<button type="button" class="btn btn-outline btn-xs" id="btn-new-disc-thread" title="Démarrer un nouveau sujet">Nouveau sujet</button>`
            : ""
        }
        <button type="button" class="btn-close-dialog" data-close-disc aria-label="Fermer la discussion">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="disc-dialog-body">
      <!-- Barre de sélection du sujet : Tous les articles OU Article précis -->
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
            <option value="rescue" ${selectedTopic === "rescue" ? "selected" : ""}>🛡️ Urgence Paiement / Problème commande</option>
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

      <!-- Coordonnées légères (pour recevoir aussi la réponse par mail si besoin) -->
      <div class="disc-identity-bar">
        <div class="form-group">
          <label for="disc-customer-name" class="visually-hidden">Votre prénom</label>
          <input
            type="text"
            id="disc-customer-name"
            class="form-control form-control-sm"
            placeholder="Votre prénom (ex: Léa)"
            value="${escapeHtml(draftName !== undefined ? draftName : activeThread?.customerName && activeThread.customerName !== "Visiteur" ? activeThread.customerName : account.authenticated && account.user ? account.user.name : "")}"
          />
        </div>
        <div class="form-group">
          <label for="disc-customer-email" class="visually-hidden">Votre e-mail (facultatif)</label>
          <input
            type="email"
            id="disc-customer-email"
            class="form-control form-control-sm"
            placeholder="Votre e-mail (facultatif, pour suivi mail)"
            value="${escapeHtml(draftEmail !== undefined ? draftEmail : activeThread?.customerEmail || (account.authenticated && account.user ? account.user.email : ""))}"
          />
        </div>
      </div>

      <!-- Zone de messages en direct -->
      <div class="disc-messages-viewport" id="disc-messages-scroll">
        ${
          !activeThread || !activeThread.messages?.length
            ? `
              <div class="disc-welcome-empty">
                <p><strong>Bonjour 👋 Comment pouvons-nous vous aider ?</strong></p>
                <p>Choisissez une question rapide ci-dessous ou écrivez directement votre message : notre équipe reçoit une notification instantanée sur son téléphone.</p>
                <div class="disc-quick-prompts">
                  ${quickQuestions
                    .map(
                      (q) => `<button type="button" class="quick-prompt-chip" data-quick-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
                    )
                    .join("")}
                </div>
              </div>
            `
            : activeThread.messages
                .map((m) => {
                  const cls =
                    m.sender === "admin" ? "msg-admin" : m.sender === "customer" ? "msg-customer" : "msg-system";
                  const who =
                    m.sender === "admin" ? "Conseiller NEXUS" : m.sender === "customer" ? "Vous" : "Information";
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
                })
                .join("")
        }
      </div>

      <!-- Suggestions rapides même quand la discussion est commencée -->
      ${
        activeThread?.messages?.length
          ? `
            <div class="disc-inline-suggestions">
              ${quickQuestions
                .slice(0, 2)
                .map(
                  (q) => `<button type="button" class="quick-prompt-chip sm" data-quick-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
                )
                .join("")}
            </div>
          `
          : ""
      }

      <!-- Saisie du message -->
      <form id="disc-send-form" class="disc-input-bar">
        <input type="text" name="website_hp" class="visually-hidden" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <label for="disc-message-input" class="visually-hidden">Votre message</label>
        <input
          type="text"
          id="disc-message-input"
          class="form-control"
          placeholder="Posez votre question sur cet article, un paiement ou une commande..."
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

  container.querySelector("#btn-new-disc-thread")?.addEventListener("click", () => {
    activeThread = null;
    activeToken = "";
    localStorage.removeItem(SAVED_THREAD_KEY);
    if (discussionSse) {
      discussionSse.close();
      discussionSse = null;
    }
    renderDiscussionDialog();
  });

  // Changement d'article / de sujet
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

  // Clic sur "Commander" depuis la discussion
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

  // Clic sur une question rapide suggérée
  container.querySelectorAll("[data-quick-q]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = container.querySelector("#disc-message-input");
      if (input) {
        input.value = chip.getAttribute("data-quick-q") || "";
        container.querySelector("#disc-send-form")?.requestSubmit();
      }
    });
  });

  // Envoi du message
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
      } else {
        // Mettre à jour nom/email si renseignés entre-temps
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
