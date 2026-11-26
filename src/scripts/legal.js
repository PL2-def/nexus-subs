import { closeDialogSmoothly } from "./mwg-helpers.js";

export const LEGAL_DOCS = {
  cgv: {
    title: "Conditions Générales de Vente (CGV)",
    lastUpdate: "Novembre 2026",
    content: `
      <h2>Article 1 — Objet</h2>
      <p>
        Les présentes Conditions Générales de Vente régissent les ventes d'abonnements numériques et de prestations d'activation réalisées sur la boutique <strong>NEXUS SUBS</strong>.
      </p>

      <h2>Article 2 — Nature des offres</h2>
      <p>
        NEXUS SUBS commercialise exclusivement des accès légitimes : invitations officielles sur compte personnel (YouTube Premium), comptes dédiés officiels compatibles partage console (PlayStation Plus Premium) et profils privés protégés par code PIN (Netflix 4K UHD). Aucun compte compromis n'est proposé.
      </p>

      <h2>Article 3 — Prix et Moyens de Paiement</h2>
      <p>
        Les tarifs affichés sont exprimés en Euros (€) TTC, sans abonnement récurrent caché. Le règlement s'effectue au comptant lors de la commande via l'un des trois moyens sécurisés proposés :
      </p>
      <ul>
        <li><strong>Stripe Checkout :</strong> Carte Bancaire (CB, Visa, Mastercard), Apple Pay, Google Pay et Link ;</li>
        <li><strong>PayPal :</strong> Paiement sécurisé via compte PayPal ;</li>
        <li><strong>Virement Bancaire Instantané SEPA (10s) :</strong> Transfert interbancaire européen via QR Code EPC ou coordonnées IBAN/BIC avec référence de commande.</li>
      </ul>

      <h2>Article 4 — Livraison en Direct &amp; par E-mail</h2>
      <p>
        Dès confirmation du règlement, les identifiants ou liens d'invitation sont transmis directement dans la <strong>boîte de dialogue de suivi de commande sur le site</strong> ainsi qu'à l'adresse électronique communiquée par le Client.
      </p>

      <h2>Article 5 — Contenu numérique &amp; Garantie 365 Jours</h2>
      <p>
        Conformément à l'article <strong>L.221-28 13° du Code de la consommation</strong>, la fourniture immédiate d'accès numériques pleinement exécutés avec l'accord préalable du consommateur ne ouvre pas droit au délai de rétractation de 14 jours.
      </p>
      <p>
        En contrepartie, chaque forfait annuel bénéficie d'une <strong>Garantie de Continuité &amp; de Remplacement Technique de 365 jours</strong> : en cas d'interruption non imputable au Client, NEXUS SUBS rétablit le service ou fournit un accès équivalent sous 24 heures ouvrées.
      </p>
    `
  },
  mentions: {
    title: "Mentions Légales",
    lastUpdate: "Novembre 2026",
    content: `
      <h2>1. Éditeur du site</h2>
      <p>La boutique en ligne <strong>NEXUS SUBS</strong> est exploitée par <strong>Gasc Enzo</strong>.</p>
      <ul>
        <li><strong>Responsable :</strong> Gasc Enzo</li>
        <li><strong>Contact &amp; Support :</strong> subpassdelivrey@gmail.com</li>
        <li><strong>Horaires d'assistance :</strong> 7j/7 de 09h00 à 22h30</li>
      </ul>

      <h2>2. Propriété intellectuelle &amp; Indépendance</h2>
      <p>
        NEXUS SUBS agit en tant que revendeur indépendant. Les marques citées (YouTube™, Google™, PlayStation™, Netflix™) appartiennent exclusivement à leurs titulaires respectifs et ne sont mentionnées qu'à titre d'indication des services compatibles.
      </p>
    `
  },
  confidentialite: {
    title: "Politique de Confidentialité (RGPD)",
    lastUpdate: "Novembre 2026",
    content: `
      <h2>1. Minimisation des données collectées</h2>
      <p>
        Nous collectons uniquement votre nom/prénom, votre adresse e-mail de livraison et l'historique de votre commande afin d'assurer la délivrance de vos accès et le suivi de garantie 365 jours.
      </p>

      <h2>2. Sécurité des paiements</h2>
      <p>
        Les données de cartes bancaires sont traitées directement par <strong>Stripe</strong> ou <strong>PayPal</strong> selon la norme PCI-DSS Niveau 1 : NEXUS SUBS n'a jamais accès à vos numéros de carte bancaire.
      </p>

      <h2>3. Exercice de vos droits</h2>
      <p>
        Vous disposez à tout moment d'un droit d'accès, de rectification et d'effacement de vos informations en écrivant à <code>subpassdelivrey@gmail.com</code>.
      </p>
    `
  },
  remboursements: {
    title: "Garantie 365 Jours & Conditions d'Exécution",
    lastUpdate: "Novembre 2026",
    content: `
      <h2>1. Garantie de Continuité 365 Jours</h2>
      <p>
        Chaque abonnement annuel acheté sur NEXUS SUBS est couvert pendant toute sa durée (365 jours) par notre engagement de fonctionnement continu. En cas de souci technique, notre support intervient sous 24h pour rétablir votre accès ou vous délivrer un remplacement immédiat sans aucun frais.
      </p>

      <h2>2. Exécution immédiate des contenus numériques</h2>
      <p>
        Conformément à l'article L.221-28 13° du Code de la consommation applicable aux biens et services numériques dématérialisés mis à disposition immédiatement après validation, les commandes validées sont fermes et définitives.
      </p>
    `
  }
};

export function setupLegalModal() {
  const dialog = document.getElementById("legal-dialog");
  const content = document.getElementById("legal-dialog-content");
  if (!dialog || !content) return;

  window.openLegalModal = (docType = "cgv") => {
    const key = LEGAL_DOCS[docType] ? docType : "cgv";
    const doc = LEGAL_DOCS[key];

    content.innerHTML = `
      <div class="legal-modal-header">
        <div>
          <span class="legal-tag">Cadre transparent</span>
          <h1 id="legal-dialog-title" class="legal-title">${doc.title}</h1>
          <p class="legal-update">Mise à jour : ${doc.lastUpdate}</p>
        </div>
        <button type="button" class="btn-close-dialog" data-close-legal aria-label="Fermer la fenêtre">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="legal-tabs-row" role="tablist" aria-label="Documents légaux">
        <button type="button" class="legal-tab-btn ${key === "cgv" ? "active" : ""}" data-legal-tab="cgv">CGV</button>
        <button type="button" class="legal-tab-btn ${key === "mentions" ? "active" : ""}" data-legal-tab="mentions">Mentions Légales</button>
        <button type="button" class="legal-tab-btn ${key === "confidentialite" ? "active" : ""}" data-legal-tab="confidentialite">Confidentialité</button>
        <button type="button" class="legal-tab-btn ${key === "remboursements" ? "active" : ""}" data-legal-tab="remboursements">Garantie 365j</button>
      </div>

      <div class="legal-modal-body">
        ${doc.content}
      </div>

      <div class="legal-modal-footer">
        <button type="button" class="btn btn-secondary" data-close-legal>Fermer</button>
      </div>
    `;

    content.querySelectorAll("[data-close-legal]").forEach((btn) => {
      btn.addEventListener("click", () => closeDialogSmoothly(dialog));
    });

    content.querySelectorAll("[data-legal-tab]").forEach((btn) => {
      btn.addEventListener("click", () => window.openLegalModal(btn.getAttribute("data-legal-tab")));
    });

    if (!dialog.open) dialog.showModal();
  };
}
