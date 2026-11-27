import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { scheduleRemoteSync } from "./remote-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEY_FILE = path.join(DATA_DIR, ".vault-key");
const RESCUE_LEDGER_FILE = path.join(DATA_DIR, "orders-rescue.jsonl");

function loadOrCreateMasterKey() {
  if (process.env.VAULT_SECRET_KEY && process.env.VAULT_SECRET_KEY.length >= 32) {
    return crypto.createHash("sha256").update(process.env.VAULT_SECRET_KEY).digest();
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (hex.length === 64) {
      return Buffer.from(hex, "hex");
    }
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { encoding: "utf8", mode: 0o600 });
  return key;
}

const MASTER_KEY = loadOrCreateMasterKey();

/**
 * Chiffrement authentifié AES-256-GCM au repos pour protéger la confidentialité
 * des identifiants livrés et des clés secrètes stockées sur le disque.
 */
export function encryptText(plainText) {
  const str = String(plainText ?? "");
  if (!str) return "";
  if (str.startsWith("enc:v1:")) return str;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(str, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptText(value) {
  const str = String(value ?? "");
  if (!str || !str.startsWith("enc:v1:")) return str;
  try {
    const parts = str.split(":");
    if (parts.length !== 5) return "";
    const iv = Buffer.from(parts[2], "hex");
    const tag = Buffer.from(parts[3], "hex");
    const encrypted = Buffer.from(parts[4], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", MASTER_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function encryptObject(obj) {
  if (!obj) return null;
  return encryptText(JSON.stringify(obj));
}

export function decryptObject(val) {
  if (!val) return null;
  if (typeof val === "object") return val;
  const json = decryptText(val);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Empreinte réseau respectueuse du RGPD (aucune IP stockée en clair : HMAC journalier tronqué)
 */
export function getPrivacyClientHash(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const rawIp = forwarded || req.socket?.remoteAddress || "local";
  const daySalt = new Date().toISOString().slice(0, 10);
  return crypto
    .createHmac("sha256", MASTER_KEY)
    .update(`${rawIp}|${daySalt}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Signature cryptographique infalsifiable de preuve d'achat (Certificat Client)
 */
export function signOrderRescueProof(order) {
  const canonical = [
    order.orderId,
    order.sepaRef || "",
    (order.email || "").toLowerCase(),
    Number(order.total).toFixed(2),
    order.currency || "EUR",
    order.createdAt
  ].join("|");

  return crypto
    .createHmac("sha256", MASTER_KEY)
    .update(canonical)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

/**
 * Journal immuable de secours (Append-Only JSONL) + Sauvegardes rotatives :
 * Même en cas de crash serveur ou coupure de courant, aucune transaction payée ou déclarée n'est perdue.
 */
export function appendRescueLedger(eventType, payload) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event: eventType,
      payload
    });
    fs.appendFileSync(RESCUE_LEDGER_FILE, entry + "\n", "utf8");
    scheduleRemoteSync("orders-rescue.jsonl");
  } catch (err) {
    console.error("[Rescue Ledger Error]", err.message);
  }
}

let lastBackupAt = 0;
export function createRollingBackupIfDue(dbFilePath) {
  const now = Date.now();
  // Maximum 1 backup file every 10 minutes, keep latest 10 snapshots
  if (now - lastBackupAt < 10 * 60 * 1000) return;
  lastBackupAt = now;
  try {
    if (!fs.existsSync(dbFilePath)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, `nexus-backup-${stamp}.json`);
    fs.copyFileSync(dbFilePath, target);

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("nexus-backup-"))
      .sort()
      .reverse();
    for (const old of files.slice(10)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  } catch {
    // ignore non-critical backup error
  }
}

/**
 * En-têtes HTTP de sécurité & de confidentialité
 */
export function isHttpsRequest(req) {
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return Boolean(req.secure || xfProto === "https");
}

export function getSessionCookieName(req) {
  return isHttpsRequest(req) ? "__Host-nexus_sid" : "nexus_sid";
}

export function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function setSessionCookie(req, res, rawToken, maxAgeSec = 60 * 60 * 24 * 7) {
  const https = isHttpsRequest(req);
  const name = getSessionCookieName(req);
  const parts = [
    `${name}=${encodeURIComponent(rawToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(60, Math.floor(maxAgeSec))}`
  ];
  if (https) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req, res) {
  const https = isHttpsRequest(req);
  const expired = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax";
  res.append("Set-Cookie", `nexus_sid=; ${expired}`);
  if (https) {
    res.append("Set-Cookie", `__Host-nexus_sid=; ${expired}; Secure`);
  }
}

export function sendClearSiteDataHeader(res) {
  res.setHeader("Clear-Site-Data", '"cookies", "storage", "cache"');
}

export function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

export function canonicalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Clé canonique anti-alias (détecte les variantes Gmail john.doe+1@gmail.com === johndoe@gmail.com)
 */
export function getCanonicalEmailKey(email) {
  const clean = canonicalizeEmail(email);
  const at = clean.indexOf("@");
  if (at <= 0) return clean;
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plusIdx = local.indexOf("+");
  if (plusIdx > 0) local = local.slice(0, plusIdx);
  if (domain === "gmail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password123",
  "password1234",
  "1234567890",
  "123456789",
  "12345678",
  "azerty123",
  "azerty1234",
  "azertyuiop",
  "qwerty123",
  "qwerty1234",
  "qwertyuiop",
  "motdepasse",
  "motdepasse123",
  "admin1234",
  "welcome123",
  "bonjour123",
  "nexus12345",
  "nexussubs1",
  "iloveyou123",
  "0000000000",
  "aaaaaaaaaa"
]);

export function validatePasswordStrength(password, email = "", fullName = "") {
  const raw = typeof password === "string" ? password : "";
  const issues = [];
  if (raw.length < 10) issues.push("Au moins 10 caractères requis");
  if (raw.length > 128) issues.push("Maximum 128 caractères autorisés");

  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  const hasDigit = /\d/.test(raw);
  const hasSymbol = /[^A-Za-z0-9]/.test(raw);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  if (raw.length < 14 && classes < 3) {
    issues.push("Combinez au moins 3 types : minuscules, majuscules, chiffres, symboles");
  } else if (raw.length >= 14 && classes < 2) {
    issues.push("Ajoutez des chiffres, majuscules ou symboles");
  }

  const lower = raw.toLowerCase().trim();
  if (COMMON_WEAK_PASSWORDS.has(lower) || /^(.)\1{5,}$/.test(raw)) {
    issues.push("Ce mot de passe est trop courant ou répétitif");
  }

  const emailLocal = canonicalizeEmail(email).split("@")[0] || "";
  if (emailLocal.length >= 4 && lower.includes(emailLocal)) {
    issues.push("Le mot de passe ne doit pas contenir votre adresse e-mail");
  }
  const cleanName = String(fullName || "").trim().toLowerCase();
  if (cleanName.length >= 4 && lower.includes(cleanName)) {
    issues.push("Le mot de passe ne doit pas contenir votre nom");
  }

  let score = 0;
  if (raw.length >= 10) score += 25;
  if (raw.length >= 14) score += 20;
  if (raw.length >= 18) score += 10;
  score += classes * 11;
  if (issues.length > 0) score = Math.min(score, 45);
  score = Math.max(0, Math.min(100, score));

  const level = score >= 80 ? "strong" : score >= 55 ? "medium" : "weak";
  return {
    valid: issues.length === 0,
    score,
    level,
    issues
  };
}

export function summarizeUserAgent(ua = "") {
  const s = String(ua || "");
  if (!s) return "Navigateur inconnu";
  let browser = "Navigateur";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\//i.test(s)) browser = "Opera";
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = "Chrome";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Safari\//i.test(s)) browser = "Safari";

  let os = "Appareil";
  if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/Linux/i.test(s)) os = "Linux";

  return `${browser} • ${os}`;
}

export function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://www.paypal.com https://www.sandbox.paypal.com"
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Vary", "Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site");
  if (isHttpsRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Protection Fetch Metadata contre les requêtes cross-site malveillantes (hors webhooks externes)
  if (!req.path.startsWith("/api/webhooks/")) {
    const site = req.get("Sec-Fetch-Site");
    const mode = req.get("Sec-Fetch-Mode");
    const dest = req.get("Sec-Fetch-Dest");
    if (site && !["same-origin", "same-site", "none"].includes(site)) {
      const isSafeNavigate =
        site === "cross-site" && mode === "navigate" && req.method === "GET" && !["object", "embed"].includes(dest);
      if (!isSafeNavigate) {
        return res.status(403).json({ error: "Requête cross-site refusée par la politique de sécurité." });
      }
    }
  }
  next();
}

/**
 * Rate-Limiter en mémoire par empreinte anonymisée
 */
export function createRateLimiter({ windowMs = 60_000, max = 20, message = "Trop de requêtes, veuillez patienter une minute." } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const key = getPrivacyClientHash(req);
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || now > entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: message, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) });
    }
    next();
  };
}

/**
 * Protection Brute-Force sur le compte Administrateur
 */
const adminLoginAttempts = new Map(); // ipHash -> { count, lockedUntil }

export function checkAdminLoginAllowed(ipHash) {
  const entry = adminLoginAttempts.get(ipHash);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const waitMin = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return {
      allowed: false,
      waitMin,
      message: `Accès temporairement verrouillé suite à plusieurs échecs. Réessayez dans ${waitMin} min.`
    };
  }
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    adminLoginAttempts.delete(ipHash);
  }
  return { allowed: true };
}

export function recordAdminLoginFailure(ipHash) {
  const entry = adminLoginAttempts.get(ipHash) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 min lockout
  }
  adminLoginAttempts.set(ipHash, entry);
  return entry;
}

export function clearAdminLoginFailures(ipHash) {
  adminLoginAttempts.delete(ipHash);
}

/**
 * Protection Brute-Force progressive pour les comptes Clients (par clé IP + e-mail)
 */
const customerLoginAttempts = new Map(); // key -> { count, lockedUntil, lastFailAt }

export function checkCustomerLoginAllowed(key) {
  const entry = customerLoginAttempts.get(key);
  if (!entry) return { allowed: true, attempts: 0 };
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const waitSec = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    const waitMin = Math.ceil(waitSec / 60);
    return {
      allowed: false,
      waitSec,
      waitMin,
      attempts: entry.count,
      message:
        waitSec < 60
          ? `Trop de tentatives. Veuillez patienter ${waitSec}s avant de réessayer.`
          : `Accès temporairement verrouillé par sécurité. Réessayez dans ${waitMin} min.`
    };
  }
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    entry.lockedUntil = 0;
  }
  // Reset si pas d'échec depuis 45 min
  if (entry.lastFailAt && Date.now() - entry.lastFailAt > 45 * 60 * 1000) {
    customerLoginAttempts.delete(key);
    return { allowed: true, attempts: 0 };
  }
  return { allowed: true, attempts: entry.count };
}

export function recordCustomerLoginFailure(key) {
  const entry = customerLoginAttempts.get(key) || { count: 0, lockedUntil: 0, lastFailAt: 0 };
  entry.count += 1;
  entry.lastFailAt = Date.now();
  if (entry.count >= 12) {
    entry.lockedUntil = Date.now() + 60 * 60 * 1000; // 60 min
  } else if (entry.count >= 8) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 min
  } else if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 5 * 60 * 1000; // 5 min
  }
  customerLoginAttempts.set(key, entry);
  return entry;
}

export function clearCustomerLoginFailures(key) {
  customerLoginAttempts.delete(key);
}
