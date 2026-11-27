/**
 * Module de Suivi Comportemental Complet sur le Site (Anti-Fraude & Diagnostic RGPD-Safe) :
 * - Collecte passive et légère des interactions sur l'ensemble du site (navigation, scroll, produits vus,
 *   panier, essais de codes promo, bascules de paiement, signaux anti-automatisation/bot)
 * - Calcule une empreinte d'appareil non-PII hachée (SHA-256) sans jamais stocker de données sensibles
 * - Transmet les événements par lots (batch + sendBeacon) au moteur anti-fraude serveur
 */

const VISITOR_ID_KEY = "nexus_visitor_id_v1";
const SESSION_ID_KEY = "nexus_session_id_v1";

function randomId(prefix) {
  try {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return `${prefix}_${Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function computeDeviceFingerprint() {
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  })();
  const raw = [
    `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    `${window.screen?.colorDepth || 0}`,
    tz,
    navigator.language || "",
    String(navigator.hardwareConcurrency || 0),
    String(navigator.maxTouchPoints || 0),
    navigator.platform || ""
  ].join("|");

  try {
    if (window.crypto?.subtle) {
      const buf = new TextEncoder().encode(raw);
      const digest = await window.crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 24);
    }
  } catch {
    // fallback non-HTTPS
  }
  return `${fnv1aHex(raw)}${fnv1aHex(raw.split("").reverse().join(""))}`;
}

function detectHeadlessSignals() {
  const signals = [];
  if (navigator.webdriver) signals.push("webdriver");
  if (window.outerWidth === 0 && window.outerHeight === 0) signals.push("zero_outer_viewport");
  if (!navigator.languages || navigator.languages.length === 0) signals.push("no_languages");
  if (/HeadlessChrome|PhantomJS|SlimerJS/i.test(navigator.userAgent || "")) signals.push("headless_ua");
  return signals;
}

class SiteTracker {
  constructor() {
    this.startedAt = Date.now();
    this.visitorId = this.loadOrCreateVisitorId();
    this.sessionId = this.loadOrCreateSessionId();
    this.deviceFingerprint = "";
    this.pendingEvents = [];
    this.recentEvents = [];
    this.dirty = false;
    this.flushTimer = null;
    this.initialized = false;

    this.metrics = {
      maxScrollDepthPct: 0,
      sectionsVisited: new Set(),
      viewedProducts: new Set(),
      cartAdds: 0,
      cartRemoves: 0,
      couponAttempts: 0,
      couponFailures: 0,
      orderLookupAttempts: 0,
      orderLookupFailures: 0,
      checkoutOpens: 0,
      checkoutAbandons: 0,
      paymentMethodSwitches: 0,
      loginFailures: 0,
      loginSuccesses: 0,
      registerAttempts: 0,
      discussionOpens: 0,
      messagesSent: 0,
      rescueSubmits: 0,
      pointerMoves: 0,
      clickCount: 0,
      scrollEvents: 0,
      keyEvents: 0,
      pasteCount: 0,
      visibilitySwitches: 0,
      webdriver: Boolean(navigator.webdriver),
      headlessSignals: detectHeadlessSignals(),
      timezone: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        } catch {
          return "";
        }
      })(),
      language: navigator.language || "",
      screenSize: `${window.screen?.width || 0}x${window.screen?.height || 0}`
    };
  }

  loadOrCreateVisitorId() {
    try {
      let vid = localStorage.getItem(VISITOR_ID_KEY);
      if (!vid) {
        vid = randomId("vis");
        localStorage.setItem(VISITOR_ID_KEY, vid);
      }
      return vid;
    } catch {
      return randomId("vis");
    }
  }

  loadOrCreateSessionId() {
    try {
      let sid = sessionStorage.getItem(SESSION_ID_KEY);
      if (!sid) {
        sid = randomId("ses");
        sessionStorage.setItem(SESSION_ID_KEY, sid);
      }
      return sid;
    } catch {
      return randomId("ses");
    }
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    this.deviceFingerprint = await computeDeviceFingerprint();

    this.track("page_enter", document.title.slice(0, 60));

    // Mouvements souris / tactile (échantillonnés pour zéro coût perf)
    let lastMoveAt = 0;
    const onPointer = () => {
      const now = Date.now();
      if (now - lastMoveAt > 250) {
        lastMoveAt = now;
        this.metrics.pointerMoves += 1;
        this.dirty = true;
      }
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("touchstart", onPointer, { passive: true });

    window.addEventListener(
      "click",
      () => {
        this.metrics.clickCount += 1;
        this.dirty = true;
      },
      { passive: true }
    );

    let lastScrollAt = 0;
    window.addEventListener(
      "scroll",
      () => {
        const now = Date.now();
        if (now - lastScrollAt < 250) return;
        lastScrollAt = now;
        this.metrics.scrollEvents += 1;
        const docH = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const pct = Math.min(100, Math.round((window.scrollY / docH) * 100));
        if (pct > this.metrics.maxScrollDepthPct) {
          this.metrics.maxScrollDepthPct = pct;
        }
        this.dirty = true;
      },
      { passive: true }
    );

    window.addEventListener(
      "keydown",
      () => {
        this.metrics.keyEvents += 1;
        this.dirty = true;
      },
      { passive: true }
    );

    // Mesure passive des copier-coller hors champs mot de passe (ne bloque JAMAIS le collage)
    document.addEventListener(
      "paste",
      (e) => {
        const target = e.target;
        if (target?.tagName === "INPUT" && target.type === "password") return;
        this.metrics.pasteCount += 1;
        this.dirty = true;
      },
      { passive: true }
    );

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.metrics.visibilitySwitches += 1;
        this.flush({ useBeacon: true });
      }
    });

    window.addEventListener("pagehide", () => {
      this.flush({ useBeacon: true });
    });

    // Observation des sections visitées sur la boutique
    if (typeof IntersectionObserver !== "undefined") {
      const sectionIds = ["products", "guide", "why-us", "faq", "support"];
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.target.id) {
              const sid = entry.target.id;
              if (!this.metrics.sectionsVisited.has(sid)) {
                this.metrics.sectionsVisited.add(sid);
                this.track("section_view", sid);
              }
            }
          }
        },
        { threshold: 0.25 }
      );
      sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) io.observe(el);
      });
    }

    this.flushTimer = setInterval(() => {
      if (this.dirty || this.pendingEvents.length > 0) {
        this.flush();
      }
    }, 10_000);
  }

  track(type, label = "", extra = {}) {
    const ev = {
      type: String(type || "").slice(0, 40),
      label: String(label || "").slice(0, 120),
      ok: extra.ok === undefined ? undefined : Boolean(extra.ok),
      ts: new Date().toISOString()
    };

    switch (ev.type) {
      case "section_view":
        if (ev.label) this.metrics.sectionsVisited.add(ev.label);
        break;
      case "product_detail_open":
        if (ev.label) this.metrics.viewedProducts.add(ev.label);
        break;
      case "cart_add":
        this.metrics.cartAdds += 1;
        break;
      case "cart_remove":
        this.metrics.cartRemoves += 1;
        break;
      case "coupon_attempt":
        this.metrics.couponAttempts += 1;
        if (ev.ok === false) this.metrics.couponFailures += 1;
        break;
      case "order_lookup_attempt":
        this.metrics.orderLookupAttempts += 1;
        if (ev.ok === false) this.metrics.orderLookupFailures += 1;
        break;
      case "checkout_open":
        this.metrics.checkoutOpens += 1;
        break;
      case "checkout_abandon":
        this.metrics.checkoutAbandons += 1;
        break;
      case "payment_method_switch":
        this.metrics.paymentMethodSwitches += 1;
        break;
      case "auth_login_fail":
        this.metrics.loginFailures += 1;
        break;
      case "auth_login_success":
        this.metrics.loginSuccesses += 1;
        break;
      case "auth_register_attempt":
        this.metrics.registerAttempts += 1;
        break;
      case "discussion_open":
        this.metrics.discussionOpens += 1;
        break;
      case "message_sent":
        this.metrics.messagesSent += 1;
        break;
      case "rescue_submit":
        this.metrics.rescueSubmits += 1;
        break;
    }

    this.pendingEvents.push(ev);
    this.recentEvents.unshift(ev);
    this.recentEvents = this.recentEvents.slice(0, 20);
    this.dirty = true;

    if (
      ["checkout_open", "checkout_abandon", "coupon_attempt", "order_lookup_attempt", "auth_login_fail"].includes(
        ev.type
      )
    ) {
      this.flush();
    }
  }

  getSnapshot() {
    return {
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      sessionDurationMs: Math.max(0, Date.now() - this.startedAt),
      maxScrollDepthPct: this.metrics.maxScrollDepthPct,
      sectionsVisited: Array.from(this.metrics.sectionsVisited),
      viewedProducts: Array.from(this.metrics.viewedProducts),
      cartAdds: this.metrics.cartAdds,
      cartRemoves: this.metrics.cartRemoves,
      couponAttempts: this.metrics.couponAttempts,
      couponFailures: this.metrics.couponFailures,
      orderLookupAttempts: this.metrics.orderLookupAttempts,
      orderLookupFailures: this.metrics.orderLookupFailures,
      checkoutOpens: this.metrics.checkoutOpens,
      checkoutAbandons: this.metrics.checkoutAbandons,
      paymentMethodSwitches: this.metrics.paymentMethodSwitches,
      loginFailures: this.metrics.loginFailures,
      loginSuccesses: this.metrics.loginSuccesses,
      registerAttempts: this.metrics.registerAttempts,
      discussionOpens: this.metrics.discussionOpens,
      messagesSent: this.metrics.messagesSent,
      rescueSubmits: this.metrics.rescueSubmits,
      pointerMoves: this.metrics.pointerMoves,
      clickCount: this.metrics.clickCount,
      scrollEvents: this.metrics.scrollEvents,
      keyEvents: this.metrics.keyEvents,
      pasteCount: this.metrics.pasteCount,
      visibilitySwitches: this.metrics.visibilitySwitches,
      webdriver: this.metrics.webdriver,
      headlessSignals: this.metrics.headlessSignals,
      timezone: this.metrics.timezone,
      language: this.metrics.language,
      screenSize: this.metrics.screenSize,
      recentEvents: this.recentEvents.slice(0, 15)
    };
  }

  getPayloadMeta() {
    return {
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      deviceFingerprint: this.deviceFingerprint,
      telemetrySnapshot: this.getSnapshot()
    };
  }

  flush({ useBeacon = false } = {}) {
    if (!this.dirty && this.pendingEvents.length === 0) return;
    const eventsToSend = this.pendingEvents.splice(0, 30);
    this.dirty = false;

    const payload = JSON.stringify({
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      deviceFingerprint: this.deviceFingerprint,
      events: eventsToSend,
      snapshot: this.getSnapshot()
    });

    try {
      if (useBeacon && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/telemetry/events", blob);
        return;
      }
      fetch("/api/telemetry/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        credentials: "same-origin",
        keepalive: useBeacon
      }).catch(() => {});
    } catch {
      // ignorer hors-ligne
    }
  }
}

export const siteTracker = new SiteTracker();
