/**
 * Persistance distante gratuite des données NEXUS dans un dépôt GitHub PRIVÉ.
 *
 * Les hébergeurs gratuits (Render Free, Koyeb, etc.) ont un disque éphémère :
 * à chaque redémarrage / mise en veille / redéploiement, le dossier `data/` est effacé.
 * Ce module :
 *  1. restaure `data/nexus-store.json` (+ journal de secours) depuis le dépôt privé au démarrage ;
 *  2. pousse chaque modification (regroupée toutes les quelques secondes) sous forme de commit ;
 *  3. vide la file d'attente avant l'arrêt du serveur (SIGTERM).
 * L'historique Git du dépôt sert en plus de sauvegarde complète versionnée.
 *
 * Variables d'environnement :
 *  - GITHUB_DATA_REPO   ex: "PL2-def/nexus-subs-data" (dépôt privé)
 *  - GITHUB_DATA_TOKEN  jeton GitHub fine-grained limité à ce dépôt (Contents: Read & write)
 *  - GITHUB_DATA_BRANCH (optionnel, défaut "main")
 *  - GITHUB_DATA_DEBOUNCE_MS (optionnel, défaut 4000)
 * Sans ces variables (développement local), le module ne fait rien.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

const REPO = (process.env.GITHUB_DATA_REPO || "").trim();
const TOKEN = (process.env.GITHUB_DATA_TOKEN || "").trim();
const BRANCH = (process.env.GITHUB_DATA_BRANCH || "main").trim();
const DEBOUNCE_MS = Number(process.env.GITHUB_DATA_DEBOUNCE_MS) || 4000;
const RETRY_MS = 15_000;

export const SYNCED_FILES = ["nexus-store.json", "orders-rescue.jsonl"];
export const remoteEnabled = Boolean(REPO && TOKEN);

let restored = false;
const states = new Map();

function st(name) {
  if (!states.has(name)) {
    states.set(name, { sha: null, timer: null, inFlight: null, dirty: false, lastB64: null });
  }
  return states.get(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ghRequest(method, name, { body, raw = false } = {}) {
  const url = new URL(`https://api.github.com/repos/${REPO}/contents/${name}`);
  if (method === "GET") url.searchParams.set("ref", BRANCH);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nexus-subs-server",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  });
  return res;
}

/** Récupère { sha, buffer } d'un fichier distant, ou null s'il n'existe pas. */
async function fetchRemoteFile(name) {
  const res = await ghRequest("GET", name);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub GET ${name} → HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  const meta = await res.json();
  let buffer;
  if (meta.content && meta.encoding === "base64") {
    buffer = Buffer.from(meta.content, "base64");
  } else if (meta.size > 0) {
    // Fichiers > 1 Mo : l'API ne renvoie pas le contenu, on le télécharge en brut.
    const rawRes = await ghRequest("GET", name, { raw: true });
    if (!rawRes.ok) throw new Error(`GitHub RAW ${name} → HTTP ${rawRes.status}`);
    buffer = Buffer.from(await rawRes.arrayBuffer());
  } else {
    buffer = Buffer.alloc(0);
  }
  return { sha: meta.sha, buffer };
}

/**
 * À appeler AVANT de charger la base (server/start.js).
 * Refuse de démarrer si le dépôt est injoignable : démarrer avec une base vide
 * puis la synchroniser écraserait les vraies données.
 */
export async function restoreFromRemote() {
  if (!remoteEnabled) {
    console.log("[RemoteStore] Désactivé (GITHUB_DATA_REPO / GITHUB_DATA_TOKEN absents) → stockage local uniquement.");
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const name of SYNCED_FILES) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const remote = await fetchRemoteFile(name);
        const s = st(name);
        const localPath = path.join(DATA_DIR, name);
        if (remote) {
          fs.writeFileSync(localPath, remote.buffer);
          s.sha = remote.sha;
          s.lastB64 = remote.buffer.toString("base64");
          console.log(`[RemoteStore] ${name} restauré depuis ${REPO}@${BRANCH} (${remote.buffer.length} octets).`);
        } else {
          console.log(`[RemoteStore] ${name} absent du dépôt distant (premier démarrage).`);
          if (fs.existsSync(localPath)) s.dirty = true;
        }
        break;
      } catch (err) {
        console.error(`[RemoteStore] Échec restauration ${name} (essai ${attempt}/5) :`, err.message);
        if (attempt >= 5) {
          throw new Error(
            `Impossible de restaurer ${name} depuis GitHub. Démarrage annulé pour ne pas écraser les données. Vérifiez GITHUB_DATA_REPO et GITHUB_DATA_TOKEN.`
          );
        }
        await sleep(2000 * attempt);
      }
    }
  }

  restored = true;
  for (const name of SYNCED_FILES) {
    if (st(name).dirty) scheduleRemoteSync(name);
  }
}

async function putFile(name, b64) {
  const s = st(name);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = {
      message: `data: sync ${name} (${new Date().toISOString()})`,
      content: b64,
      branch: BRANCH,
      ...(s.sha ? { sha: s.sha } : {})
    };
    const res = await ghRequest("PUT", name, { body });
    if (res.ok) {
      const json = await res.json();
      s.sha = json?.content?.sha || null;
      return;
    }
    // SHA périmé / manquant : on relit le SHA distant puis on réessaie.
    if (res.status === 409 || res.status === 422) {
      const remote = await fetchRemoteFile(name).catch(() => null);
      s.sha = remote?.sha || null;
      continue;
    }
    throw new Error(`GitHub PUT ${name} → HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  throw new Error(`GitHub PUT ${name} : conflit de version persistant.`);
}

function pushFile(name) {
  const s = st(name);
  if (s.inFlight) {
    s.dirty = true;
    return s.inFlight;
  }
  s.inFlight = (async () => {
    while (s.dirty) {
      s.dirty = false;
      const localPath = path.join(DATA_DIR, name);
      if (!fs.existsSync(localPath)) continue;
      const b64 = fs.readFileSync(localPath).toString("base64");
      if (b64 === s.lastB64) continue;
      try {
        await putFile(name, b64);
        s.lastB64 = b64;
      } catch (err) {
        console.error(`[RemoteStore] Échec synchronisation ${name} :`, err.message);
        s.dirty = true;
        if (!s.timer) {
          s.timer = setTimeout(() => {
            s.timer = null;
            pushFile(name);
          }, RETRY_MS);
        }
        return;
      }
    }
  })().finally(() => {
    s.inFlight = null;
    if (s.dirty && !s.timer) scheduleRemoteSync(name);
  });
  return s.inFlight;
}

/** Signale qu'un fichier de `data/` a changé : il sera poussé sous DEBOUNCE_MS. */
export function scheduleRemoteSync(name) {
  if (!remoteEnabled || !restored) return;
  const s = st(name);
  s.dirty = true;
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    pushFile(name);
  }, DEBOUNCE_MS);
}

/** Pousse immédiatement toutes les modifications en attente (avant arrêt). */
export async function flushRemote() {
  if (!remoteEnabled || !restored) return;
  const pending = [];
  for (const name of SYNCED_FILES) {
    const s = st(name);
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    if (s.dirty || s.inFlight) {
      s.dirty = true;
      pending.push(pushFile(name));
    }
  }
  await Promise.allSettled(pending);
  // Un second passage si des écritures sont arrivées pendant le premier.
  const again = SYNCED_FILES.filter((n) => st(n).dirty).map((n) => pushFile(n));
  await Promise.allSettled(again);
}
