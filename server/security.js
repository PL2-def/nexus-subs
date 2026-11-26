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
 * Signature cryptographique infalsifiable de preuve d'achat (Garantie Zéro Perte Client)
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
