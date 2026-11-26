/**
 * Point d'entrée production (hébergement cloud).
 * 1. Restaure les données depuis le dépôt GitHub privé (si configuré)
 * 2. Démarre le serveur Express
 * 3. Sauvegarde les dernières modifications avant l'arrêt (veille / redéploiement)
 */
import { restoreFromRemote, flushRemote } from "./remote-store.js";

try {
  await restoreFromRemote();
} catch (err) {
  console.error("[Start]", err.message);
  process.exit(1);
}

await import("./index.js");

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Start] ${signal} reçu → sauvegarde des données en cours…`);
  try {
    await Promise.race([flushRemote(), new Promise((r) => setTimeout(r, 20_000))]);
    console.log("[Start] Données sauvegardées. Arrêt.");
  } catch (err) {
    console.error("[Start] Erreur lors de la sauvegarde finale :", err.message);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
