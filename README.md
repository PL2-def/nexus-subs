# NEXUS SUBS v3 — Boutique d'Abonnements Premium, Sécurité Anti-Fraude, Garantie Zéro Perte & Centre de Discussions

Plateforme e-commerce complète (Frontend Vite + Backend Express sécurisé + SSE temps réel) conçue pour vendre vos abonnements numériques annuels avec **Stripe**, **PayPal**, **Virement SEPA Instantané par QR Code EPC**, **notifications push instantanées sur votre téléphone**, **garantie zéro perte financière**, **guide client interactif**, **messagerie universelle en direct** et **centre de triage Admin intelligent**.

---

## Comment se connecter au Compte Administrateur ?

Vous disposez de **3 moyens rapides** pour ouvrir l'interface d'administration depuis n'importe quelle page :
1. Cliquez sur le bouton **`🛡️ Admin`** en haut à droite de la barre de navigation.
2. Accédez directement à l'adresse : **`http://localhost:3000/#admin`**
3. Utilisez le raccourci clavier rapide : **`Alt + Shift + A`**

**Identifiants initiaux :**
- **E-mail administrateur** : `subpassdelivrey@gmail.com`
- **Mot de passe initial** : `admin`
- *Pour modifier votre mot de passe* : une fois connecté, ouvrez l'onglet **`Téléphone, Paiements & Sécurité`**, saisissez un nouveau mot de passe dans le champ dédié puis cliquez sur **Enregistrer**.

---

## Nouveautés Majeures v3

### 1. Sécurité de Confidentialité & Protection Anti-Fraude
- **Chiffrement AES-256-GCM au repos (`data/.vault-key`)** : les identifiants d'abonnements livrés (`deliveredAccess`) et vos clés secrètes API (Stripe, PayPal, SMTP) sont chiffrés sur le disque (`enc:v1:...`).
- **Confidentialité RGPD & Masquage écran** : aucune adresse IP brute n'est stockée (empreinte HMAC journalière salée uniquement). Côté client, les mots de passe et codes PIN reçus sont masqués par défaut avec révélation temporaire de **15 secondes** et bouton **« 🔒 Effacer de cet appareil »** pour les ordinateurs partagés.
- **Bouclier HTTP & Isolation Fetch Metadata** : en-têtes `Content-Security-Policy` (`frame-ancestors 'none'; object-src 'none'`), `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, blocage cross-site `Sec-Fetch-Site` et verrouillage anti-force brute sur le compte Admin (5 essais max / 15 min).
- **Score Anti-Fraude Automatique (`0–100`)** : détection des e-mails jetables (`yopmail`, etc.), champ honeypot anti-robot, remplissage anormalement rapide (`< 1,2s`), déclarations SEPA/PayPal suspectes (`< 9s` après ouverture), rafales de commandes impayées et blocage 1-clic d'un client ou appareil depuis l'Admin.

### 2. Garantie « Zéro Perte » & Solutions de Secours Anti-Bug
- **Certificat de Preuve d'Achat Signé HMAC (`.txt`)** : téléchargeable en 1 clic dès la création de commande avec numéro, articles, montant, IBAN/référence et signature cryptographique vérifiable.
- **Journal de Secours Inaltérable (`data/orders-rescue.jsonl`) + Sauvegardes Rotatives (`data/backups/`)** : chaque événement de commande et de paiement est doublé hors de la base principale pour qu'aucune transaction ne puisse jamais disparaître.
- **File d'Attente Hors-Ligne Automatique** : si la connexion Internet du client coupe au moment de confirmer son paiement, le navigateur sauvegarde sa déclaration et la synchronise automatiquement dès le retour du réseau.
- **Guichet « 🛡️ Secours Paiement » (`#rescue-dialog`)** : accessible partout (ruban supérieur, pied de page, guide, suivi de commande) pour signaler un débit sans accès reçu, déclenchant une alerte prioritaire sur votre téléphone (`ntfy`) et l'ouverture d'une discussion urgente.

### 3. Guide Complet d'Achat, de Réception & d'Activation (`#guide`)
- Section interactive en **4 onglets** consultables à tout moment :
  1. **Comment acheter (3 étapes)**
  2. **Recevoir mon bien** (fenêtre temps réel + e-mail + coffre masqué)
  3. **Activer mon abonnement** (procédures détaillées YouTube Premium, PS Plus PS5/PS4, Netflix 4K)
  4. **Secours & Zéro Perte**

### 4. Boîte de Dialogue Universelle Client & Menu Admin « Discussions »
- **Côté Client** : bouton flottant permanent **« 💬 Discuter / Une question ? »**, bouton d'en-tête et bouton **« 💬 Poser une question sur cet article »** sur chaque carte produit. Le client peut parler **de tous les articles en général**, sélectionner **un article précis** (avec aperçu prix/stock et achat 1-clic) ou ouvrir une **urgence paiement**, avec réponses en temps réel (SSE).
- **Côté Admin — Menu `💬 Discussions`** : interface claire en double colonne avec compteurs, filtres rapides et diagnostics automatiques précis :
  - **`🚨 Suspecté de fraude`** (avec détail exact des motifs et score de risque)
  - **`⏳ En attente depuis X`** (calculé et actualisé en direct)
  - **`😤 Agacé`** (détection automatique de frustration/mots-clés + bascule manuelle)
  - **`⚡ Nécessite de l'aide rapide`** (urgence, blocage paiement ou attente prolongée)
  - **`✅ Résolu`** + réponses rapides pré-rédigées, envoi de fiche produit ou code promo dans le chat, et blocage client en 1 clic.

---

## Démarrage Rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer en développement (Serveur API + Vite sur http://localhost:3000)
npm run dev

# 3. Compiler et lancer en production (Serveur unifié sur http://localhost:3000)
npm start
```
