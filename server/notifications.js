import nodemailer from "nodemailer";
import QRCode from "qrcode";
import { db } from "./db.js";

const NTFY_PRIORITY_MAP = {
  min: 1,
  low: 2,
  default: 3,
  high: 4,
  urgent: 5,
  max: 5
};

/**
 * Envoie une notification push instantanée en priorité URGENTE (5) sur l'iPhone/Android de l'admin via ntfy.sh (JSON UTF-8)
 * + Webhook optionnel (Discord / Telegram / Slack).
 */
export async function sendMobilePushNotification({
  title,
  message,
  priority = "urgent",
  tags = "shopping_cart,sparkles",
  clickUrl = ""
}) {
  const cfg = db.data.settings.notifications;
  const results = { ntfy: false, webhook: false, errors: [] };

  const numericPriority =
    typeof priority === "number"
      ? Math.min(5, Math.max(1, Math.round(priority)))
      : NTFY_PRIORITY_MAP[String(priority || "urgent").toLowerCase()] || 5;

  // 1. ntfy.sh Push Mobile (iOS Time-Sensitive / Urgent & Android) en JSON UTF-8
  // (Le POST JSON vers la racine évite le crash Node fetch ByteString sur les emojis et accents français)
  if (cfg.ntfyEnabled && cfg.ntfyTopic) {
    try {
      const baseServer = (cfg.ntfyServer || "https://ntfy.sh").replace(/\/+$/, "");
      const tagList = Array.isArray(tags)
        ? tags.map((t) => String(t).trim()).filter(Boolean)
        : String(tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

      const payload = {
        topic: String(cfg.ntfyTopic).trim(),
        title: String(title || "Alerte NEXUS SUBS").replace(/[\r\n]+/g, " ").slice(0, 140),
        message: String(message || "").slice(0, 3500),
        priority: numericPriority,
        tags: tagList
      };

      if (clickUrl && /^https?:\/\//i.test(clickUrl)) {
        payload.click = clickUrl;
        payload.actions = [
          {
            action: "view",
            label: "Ouvrir l'Admin",
            url: clickUrl,
            clear: true
          }
        ];
      }

      const resp = await fetch(baseServer, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(payload)
      });
      results.ntfy = resp.ok;
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        results.errors.push(`ntfy HTTP ${resp.status}${errBody ? `: ${errBody.slice(0, 120)}` : ""}`);
      }
    } catch (err) {
      results.errors.push(`ntfy: ${err.message}`);
    }
  }

  // 2. Webhook optionnel (Discord, Slack, Make, etc.)
  if (cfg.webhookUrl && cfg.webhookUrl.startsWith("http")) {
    try {
      const payload = cfg.webhookUrl.includes("discord.com")
        ? {
            content: `🔔 **${title}**\n${message}${clickUrl ? `\n👉 ${clickUrl}` : ""}`
          }
        : { title, message, clickUrl, timestamp: new Date().toISOString() };

      const resp = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      results.webhook = resp.ok;
    } catch (err) {
      results.errors.push(`webhook: ${err.message}`);
    }
  }

  return results;
}

export async function generateNtfyQrDataUrl() {
  const cfg = db.data.settings.notifications;
  const baseServer = (cfg.ntfyServer || "https://ntfy.sh").replace(/\/+$/, "");
  const subscribeUrl = `${baseServer}/${cfg.ntfyTopic}`;
  const qrDataUrl = await QRCode.toDataURL(subscribeUrl, {
    width: 220,
    margin: 1,
    color: { dark: "#07080e", light: "#ffffff" }
  });
  return { subscribeUrl, topic: cfg.ntfyTopic, qrDataUrl };
}

/**
 * Construit le contenu texte et HTML de l'e-mail de livraison des accès client
 */
export function buildAccessEmailContent(order, accessPayload) {
  const subject = `Vos accès NEXUS SUBSCRIPTIONS — Commande #${order.orderId}`;
  const credsList = Array.isArray(accessPayload.credentials) ? accessPayload.credentials : [];

  const textLines = [
    `Bonjour ${order.customerName},`,
    ``,
    `Merci pour votre confiance ! Votre commande #${order.orderId} (${order.total} €) est prête.`,
    `Voici vos informations d'accès et d'activation :`,
    ``
  ];

  for (const c of credsList) {
    textLines.push(`=== ${c.productTitle || "Abonnement"} ===`);
    if (c.inviteLink) textLines.push(`Lien d'activation : ${c.inviteLink}`);
    if (c.login) textLines.push(`Identifiant / E-mail : ${c.login}`);
    if (c.password) textLines.push(`Mot de passe : ${c.password}`);
    if (c.profile) textLines.push(`Profil attribué : ${c.profile}`);
    if (c.pin) textLines.push(`Code PIN : ${c.pin}`);
    if (c.instructions) textLines.push(`Instructions : ${c.instructions}`);
    textLines.push(``);
  }

  if (accessPayload.customMessage) {
    textLines.push(`Message de votre conseiller :`);
    textLines.push(accessPayload.customMessage);
    textLines.push(``);
  }

  textLines.push(`Assistance 7j/7 : ${db.data.settings.supportEmail}`);
  textLines.push(`L'équipe NEXUS SUBSCRIPTIONS`);

  const htmlCards = credsList
    .map(
      (c) => `
      <div style="background:#111625;border:1px solid #262f45;border-radius:12px;padding:18px;margin-bottom:14px;color:#f8fafc;">
        <h3 style="margin:0 0 10px;color:#a78bfa;font-size:17px;">${escapeHtml(c.productTitle || "Abonnement")}</h3>
        ${c.inviteLink ? `<p style="margin:6px 0;"><strong>Lien d'activation :</strong> <a href="${escapeHtml(c.inviteLink)}" style="color:#38bdf8;">${escapeHtml(c.inviteLink)}</a></p>` : ""}
        ${c.login ? `<p style="margin:6px 0;"><strong>Identifiant :</strong> <code style="background:#07080e;padding:3px 8px;border-radius:6px;color:#38bdf8;">${escapeHtml(c.login)}</code></p>` : ""}
        ${c.password ? `<p style="margin:6px 0;"><strong>Mot de passe :</strong> <code style="background:#07080e;padding:3px 8px;border-radius:6px;color:#38bdf8;">${escapeHtml(c.password)}</code></p>` : ""}
        ${c.profile ? `<p style="margin:6px 0;"><strong>Profil :</strong> ${escapeHtml(c.profile)}</p>` : ""}
        ${c.pin ? `<p style="margin:6px 0;"><strong>Code PIN :</strong> <code style="background:#07080e;padding:3px 8px;border-radius:6px;color:#10b981;">${escapeHtml(c.pin)}</code></p>` : ""}
        ${c.instructions ? `<p style="margin:10px 0 0;color:#cbd5e1;font-size:14px;white-space:pre-line;">${escapeHtml(c.instructions)}</p>` : ""}
      </div>
    `
    )
    .join("");

  const html = `
    <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#07080e;color:#f8fafc;padding:28px;border-radius:16px;border:1px solid #1e293b;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;font-weight:800;padding:6px 12px;border-radius:8px;font-size:13px;">NEXUS • SUBS</span>
      </div>
      <h1 style="font-size:22px;margin:0 0 10px;color:#ffffff;">Vos accès sont prêts, ${escapeHtml(order.customerName)} !</h1>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Voici les informations d'activation pour votre commande <strong>#${escapeHtml(order.orderId)}</strong> (${order.total} €) :
      </p>
      ${htmlCards}
      ${
        accessPayload.customMessage
          ? `<div style="background:#0e1726;border-left:3px solid #06b6d4;padding:12px 16px;border-radius:8px;margin:16px 0;color:#e2e8f0;font-size:14px;white-space:pre-line;"><strong>Note de l'équipe :</strong><br>${escapeHtml(accessPayload.customMessage)}</div>`
          : ""
      }
      <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0;">
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0;">
        Garantie de continuité 365 jours incluse. Besoin d'aide ? Répondez directement à cet e-mail ou écrivez à <a href="mailto:${escapeHtml(db.data.settings.supportEmail)}" style="color:#a78bfa;">${escapeHtml(db.data.settings.supportEmail)}</a>.
      </p>
    </div>
  `;

  const plainBody = textLines.join("\n");
  const mailtoUrl = `mailto:${encodeURIComponent(order.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainBody)}`;

  return { subject, text: plainBody, html, mailtoUrl };
}

export async function sendEmailIfConfigured({ to, subject, text, html }) {
  const smtp = db.data.settings.notifications.smtp;
  if (!smtp || !smtp.enabled || !smtp.host || !smtp.user || !smtp.pass) {
    return { sent: false, reason: "SMTP non configuré (utilisez le bouton Mail rapide ou ajoutez votre mot de passe d'application Gmail dans Paramètres)." };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port) || 465,
      secure: Boolean(smtp.secure),
      auth: {
        user: smtp.user,
        pass: smtp.pass
      }
    });

    await transporter.sendMail({
      from: `"${smtp.fromName || "NEXUS SUBS"}" <${smtp.user}>`,
      to,
      subject,
      text,
      html
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
