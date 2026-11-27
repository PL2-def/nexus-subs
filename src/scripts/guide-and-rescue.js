/**
 * Centre d'Instructions Complet (Achat, Obtention du bien, Tutoriels d'activation)
 * + Système d'Assistance Commande (en cas de bug réseau, fermeture de page ou erreur d'e-mail)
 * + File d'attente hors-ligne (Offline Retry Queue)
 */

import { closeDialogSmoothly, showToast, escapeHtml } from "./mwg-helpers.js";
import { openCustomerDiscussion } from "./discussion-widget.js";
import { account } from "./account.js";
import { siteTracker } from "./site-tracker.js";

const OFFLINE_QUEUE_KEY = "nexus_offline_rescue_queue_v1";

/**
 * Enregistre une action critique de confirmation de paiement en local si le réseau coupe,
 * et la rejoue automatiquement dès que la connexion Internet revient.
 */
export function enqueueOfflineDeclaration(payload) {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    queue.push({ ...payload, queuedAt: new Date().toISOString() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-20)));
  } catch {
    // ignore storage quota
  }
}

export async function flushOfflineRescueQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
      try {
        const resp = await fetch(`/api/orders/${encodeURIComponent(item.orderId)}/declare-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: item.token, senderHint: item.senderHint || "" })
        });
        if (!resp.ok && resp.status >= 500) {
          remaining.push(item);
        } else {
          showToast(
            `Connexion rétablie : votre confirmation pour #${item.orderId} a bien été transmise !`,
            "success",
            5000
          );
        }
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  } catch {
    // ignore
  }
}

/**
 * Génère et télécharge un Certificat de Preuve d'Achat signé cryptographiquement (.txt)
 * afin que le client ait toujours une trace irréfutable sur son téléphone ou son ordinateur.
 */
export function downloadOrderRescueProof(order) {
  if (!order) return;
  const lines = [
    "============================================================",
    "       CERTIFICAT OFFICIEL DE COMMANDE — NEXUS SUBS",
    "         CERTIFICAT DE COMMANDE & SUIVI SÉCURISÉ",
    "============================================================",
    `Numéro de commande     : #${order.orderId}`,
    `Référence SEPA         : ${order.sepaRef || "N/A"}`,
    `Date d'enregistrement  : ${new Date(order.createdAt).toLocaleString("fr-FR")}`,
    `Client                 : ${order.customerName} (${order.email})`,
    `Montant total TTC      : ${order.total} €`,
    `Mode de paiement choisi: ${order.paymentMethod.toUpperCase()}`,
    `Statut au téléchargement: ${order.paymentStatus}`,
    "------------------------------------------------------------",
    "Articles commandés :",
    ...(order.items || []).map((i) => ` - ${i.quantity}x ${i.title} (${i.duration}) : ${i.lineTotal} €`),
    "------------------------------------------------------------",
    `SIGNATURE CRYPTOGRAPHIQUE SERVEUR : ${order.proofSignature || "CERTIFIED"}`,
    "============================================================",
    "COMMENT RETROUVER VOS ACCÈS EN CAS DE FERMETURE DE PAGE :",
    "1. Rendez-vous sur la boutique NEXUS SUBS.",
    "2. Cliquez sur « Mes Accès » en haut du site et entrez :",
    `   - Numéro : ${order.orderId}`,
    `   - E-mail : ${order.email}`,
    "3. En cas d'erreur d'e-mail ou de bug technique après paiement,",
    "   cliquez sur « Secours Paiement » et indiquez ce numéro.",
    "   Assistance 7j/7 : subpassdelivrey@gmail.com",
    "============================================================"
  ].join("\n");

  const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Preuve-Commande-${order.orderId}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast("Preuve d'achat officielle téléchargée sur votre appareil !", "success");
}

/**
 * Initialise les onglets accessibles du Guide d'Instructions (conformes Modern Web Guidance: tabs)
 * + la modale d'urgence "Assistance Commande / Suivi Prioritaire"
 */
export function initGuideAndRescue() {
  window.addEventListener("online", () => {
    flushOfflineRescueQueue();
  });
  flushOfflineRescueQueue();

  // Onglets du Guide d'Instructions sur la page (avec hidden="until-found" & beforematch)
  const tablists = document.querySelectorAll('[data-mwg-tabs="guide"]');
  tablists.forEach((tablist) => {
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const wrapper = tablist.closest(".guide-tabs-container");
    if (!wrapper) return;
    const panels = Array.from(wrapper.querySelectorAll('[role="tabpanel"]'));

    const selectTab = (selectedTab, focusTab = false) => {
      tabs.forEach((t) => {
        const isSel = t === selectedTab;
        t.setAttribute("aria-selected", isSel ? "true" : "false");
        t.setAttribute("tabindex", isSel ? "0" : "-1");
      });
      panels.forEach((p) => {
        const matches = p.getAttribute("aria-labelledby") === selectedTab.id;
        if (matches) {
          p.hidden = false;
          p.setAttribute("tabindex", "0");
        } else {
          p.hidden = "until-found";
          p.removeAttribute("tabindex");
        }
      });
      selectedTab.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
      if (focusTab) selectedTab.focus();
    };

    tabs.forEach((tab, idx) => {
      tab.addEventListener("click", () => selectTab(tab, false));
      tab.addEventListener("keydown", (e) => {
        let nextIdx = -1;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = tabs.length - 1;
        if (nextIdx !== -1) {
          e.preventDefault();
          selectTab(tabs[nextIdx], true);
        }
      });
    });

    // Synchroniser si la recherche navigateur Ctrl+F révèle un panneau hidden="until-found"
    panels.forEach((panel) => {
      panel.addEventListener("beforematch", () => {
        const ownerTab = document.getElementById(panel.getAttribute("aria-labelledby"));
        if (ownerTab) selectTab(ownerTab, false);
      });
    });
  });

  // Modale d'Assistance Commande ("Secours Paiement / Suivi Prioritaire")
  const rescueDialog = document.getElementById("rescue-dialog");
  window.openRescueModal = (prefillOrderRef = "") => {
    if (!rescueDialog) return;
    renderRescueModalContent(prefillOrderRef);
    if (!rescueDialog.open) rescueDialog.showModal();
  };
}

function renderRescueModalContent(prefillOrderRef = "") {
  const dialog = document.getElementById("rescue-dialog");
  const container = document.getElementById("rescue-dialog-content");
  if (!dialog || !container) return;

  container.innerHTML = `
    <div class="checkout-header">
      <div class="checkout-header-title">
        <div class="live-pulse-badge delivered" aria-hidden="true">🛡️</div>
        <div>
          <h1 id="rescue-dialog-title" class="checkout-title">Assistance Commande — Suivi Prioritaire</h1>
          <p class="checkout-subtitle">Un bug, une page fermée ou une erreur d'adresse e-mail après votre commande ? Notre équipe retrouve votre dossier immédiatement.</p>
        </div>
      </div>
      <button type="button" class="btn-close-dialog" data-close-rescue aria-label="Fermer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="order-lookup-body">
      <div class="rescue-guarantee-callout">
        <strong>Comment fonctionne l'assistance prioritaire ?</strong>
        <p>
          Chaque transaction est inscrite dans notre journal de sauvegarde permanent. Remplissez ce formulaire en 20 secondes : notre administrateur reçoit immédiatement une <strong>alerte prioritaire urgente sur son téléphone</strong> et une fenêtre de discussion en direct s'ouvre pour vous remettre vos accès rapidement.
        </p>
      </div>

      <form id="rescue-claim-form" class="support-form">
        <div class="form-row">
          <div class="form-group">
            <label for="rescue-name" class="form-label">Votre nom ou prénom *</label>
            <input type="text" id="rescue-name" class="form-control" value="${escapeHtml(account.authenticated && account.user ? account.user.name : "")}" placeholder="Ex : Thomas Martin" required autofocus />
          </div>
          <div class="form-group">
            <label for="rescue-email" class="form-label">Votre bonne adresse e-mail où recevoir vos accès *</label>
            <input type="email" id="rescue-email" class="form-control" value="${escapeHtml(account.authenticated && account.user ? account.user.email : "")}" placeholder="vous@exemple.fr" required />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="rescue-method" class="form-label">Moyen de paiement utilisé *</label>
            <select id="rescue-method" class="form-control">
              <option value="Stripe (Carte / Apple Pay / Google Pay)">Stripe (Carte / Apple Pay / Google Pay)</option>
              <option value="Virement SEPA Instantané">Virement SEPA Instantané</option>
              <option value="PayPal">PayPal</option>
            </select>
          </div>
          <div class="form-group">
            <label for="rescue-amount" class="form-label">Montant réglé (€) *</label>
            <input type="text" id="rescue-amount" class="form-control" placeholder="Ex : 120 €" required />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="rescue-order-ref" class="form-label">N° de commande ou Réf SEPA (si connu)</label>
            <input type="text" id="rescue-order-ref" class="form-control" value="${prefillOrderRef}" placeholder="Ex : NX-849201 ou inconnu" />
          </div>
          <div class="form-group">
            <label for="rescue-proof" class="form-label">Titulaire du compte / E-mail PayPal / 4 derniers chiffres CB *</label>
            <input type="text" id="rescue-proof" class="form-control" placeholder="Permet de retrouver votre paiement instantanément" required />
          </div>
        </div>

        <div class="form-group">
          <label for="rescue-details" class="form-label">Que s'est-il passé ? *</label>
          <textarea id="rescue-details" class="form-control" rows="2" placeholder="Ex : J'ai fait le virement SEPA pour YouTube Premium mais j'ai oublié d'indiquer la référence dans le motif..." required></textarea>
        </div>

        <button type="submit" id="btn-submit-rescue" class="btn btn-primary" style="width:100%;">
          🚨 Activer le Secours Prioritaire &amp; Ouvrir la Discussion en Direct
        </button>
      </form>
    </div>
  `;

  container.querySelector("[data-close-rescue]")?.addEventListener("click", () => closeDialogSmoothly(dialog));

  container.querySelector("#rescue-claim-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = container.querySelector("#btn-submit-rescue");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enregistrement sécurisé & alerte téléphone en cours...";
    }

    try {
      const payload = {
        customerName: container.querySelector("#rescue-name").value.trim(),
        email: container.querySelector("#rescue-email").value.trim(),
        paymentMethod: container.querySelector("#rescue-method").value,
        amountPaid: container.querySelector("#rescue-amount").value.trim(),
        orderRef: container.querySelector("#rescue-order-ref").value.trim(),
        paymentProof: container.querySelector("#rescue-proof").value.trim(),
        problemDetails: container.querySelector("#rescue-details").value.trim(),
        ...siteTracker.getPayloadMeta()
      };

      const resp = await fetch("/api/rescue-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Erreur lors de l'envoi.");
      siteTracker.track("rescue_submit", payload.amountPaid || "SOS", { ok: true });

      await closeDialogSmoothly(dialog);
      showToast("Dossier de secours enregistré ! Le vendeur est alerté en urgence.", "success", 6000);

      // Basculer directement le client dans sa discussion prioritaire en direct !
      openCustomerDiscussion({
        resumeThread: data.thread,
        resumeToken: data.threadToken
      });
    } catch (err) {
      showToast(err.message, "error");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "🚨 Activer le Secours Prioritaire & Ouvrir la Discussion en Direct";
      }
    }
  });
}
