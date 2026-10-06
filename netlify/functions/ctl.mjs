// Contrôle des employés : journal d'activité partagé + comptes/droits synchronisés.
// Variable d'environnement Netlify : APP_KEY (clé de l'entreprise, la même que pour WhatsApp).
// Stockage : Netlify Blobs (rien d'autre à installer ni à payer).
// IMPORTANT : lecture « forte » (consistency: "strong"). Par défaut Netlify Blobs est « différé » : une lecture peut renvoyer
// l'ancienne valeur jusqu'à 60 secondes après une écriture, ce qui bloquait la numérotation et la synchronisation.
import { getStore } from "@netlify/blobs";

let _store = null, _mode = "";
async function openStore() {
  if (_store) return _store;
  const s = getStore({ name: "sm-ctl", consistency: "strong" });
  try { await s.get("cfg"); _store = s; _mode = "strong"; }
  catch (e) {
    if (/consistency|uncachedEdgeURL/i.test(String((e && (e.name + e.message)) || ""))) { _store = getStore("sm-ctl"); _mode = "eventual"; }
    else throw e;
  }
  return _store;
}

const J = (code, o) => new Response(JSON.stringify(o), { status: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Écriture « lecture-modification-écriture » protégée contre les accès simultanés (deux appareils au même instant).
async function cas(store, key, fresh, mut) {
  for (let i = 0; i < 12; i++) {
    const e = await store.getWithMetadata(key, { type: "json" });
    const cur = e ? e.data : fresh();
    const next = await mut(cur);
    const r = await store.setJSON(key, next, e ? { onlyIfMatch: e.etag } : { onlyIfNew: true });
    if (!r || r.modified !== false) return next;
    await new Promise((res) => setTimeout(res, 20 + Math.random() * 100));
  }
  throw new Error("Écriture simultanée : réessayez");
}

export default async (req) => {
  const KEY = Netlify.env.get("APP_KEY");
  const url = new URL(req.url), a = url.searchParams.get("a");

  // Diagnostic (ouvrir /api/ctl?a=ping dans le navigateur) : ne révèle aucun secret.
  if (a === "ping") {
    const o = { fn: true, v: 21, appKey: !!KEY };
    try {
      const st = await openStore(); o.store = _mode;
      const c = await st.get("cfg", { type: "json" }), q = await st.get("seq", { type: "json" });
      o.cfg = !!(c && c.users); o.seqInit = !!(q && q.init);
      if (KEY && (req.headers.get("x-app-key") || "") === KEY) {
        o.keyOk = true;
        const w = c && c.users ? c.users.find((u) => u.id === (req.headers.get("x-uid") || "") && u.pin && u.pin === (req.headers.get("x-ph") || "")) : null;
        o.authOk = !!w; o.admin = !!w && w.role === "admin";
      } else o.keyOk = false;
    } catch (e) { o.store = "erreur : " + String((e && e.message) || e).slice(0, 160); }
    return J(200, o);
  }

  if (!KEY) return J(500, { error: "APP_KEY non définie sur Netlify" });
  let store;
  try { store = await openStore(); } catch (e) { return J(500, { error: "Stockage indisponible : " + String((e && e.message) || e).slice(0, 160) }); }

  // Connexion d'un nouvel appareil avec la seule clé d'accès (aucune clé d'entreprise requise).
  if (a === "login" && req.method === "POST") {
    try {
      const now = Date.now();
      const rl0 = await store.get("rl", { type: "json" });
      if (rl0 && rl0.until > now) return J(429, { error: "Trop d'essais", wait: Math.ceil((rl0.until - now) / 1000) });
      const b = await req.json().catch(() => ({}));
      const ph0 = String(b.ph || "");
      const c0 = await store.get("cfg", { type: "json" });
      if (!c0 || !c0.users) return J(409, { error: "noinit" });
      const u0 = ph0.length > 20 ? c0.users.find((u) => u.pin && u.pin === ph0) : null;
      if (u0) {
        await cas(store, "rl", () => ({ n: 0, t: 0, until: 0 }), (r) => { r.n = 0; r.until = 0; return r; });
        const full = u0.role === "admin";
        const users = c0.users.map((u) => ({ id: u.id, nom: u.nom, role: u.role, perms: u.perms || null, pin: full || u.id === u0.id ? u.pin : (u.pin ? "!" : null) }));
        return J(200, { key: KEY, uid: u0.id, cfg: { users, rev: c0.rev } });
      }
      // échec : on compte (10 essais en 10 minutes => blocage de 10 minutes) et on le note au journal
      await cas(store, "rl", () => ({ n: 0, t: 0, until: 0 }), (r) => {
        if (!r.t || now - r.t > 600000) { r.n = 0; r.t = now; }
        r.n++; if (r.n >= 10) { r.until = now + 600000; r.n = 0; r.t = 0; }
        return r;
      });
      const id = Math.random().toString(36).slice(2, 8), t = new Date().toISOString();
      await store.setJSON(`log/${t}_${id}`, { id, t, u: "?", n: "Inconnu", a: "echec", d: "Clé d'accès inconnue (tentative de connexion d'un nouvel appareil)", m: 0, dev: "", v: false });
      return J(401, { error: "Clé incorrecte" });
    } catch (err) {
      return J(500, { error: String((err && err.message) || err) });
    }
  }

  if ((req.headers.get("x-app-key") || "") !== KEY) return J(401, { error: "Clé invalide" });
  const uid = req.headers.get("x-uid") || "", ph = req.headers.get("x-ph") || "";
  const cfg = await store.get("cfg", { type: "json" });
  const who = cfg && cfg.users ? cfg.users.find((u) => u.id === uid && u.pin && u.pin === ph) : null;
  const isAdmin = !!who && who.role === "admin";
  const boot = !cfg; // tant qu'aucun compte n'est enregistré, la clé suffit pour créer la configuration

  try {
    if (a === "cfg" && req.method === "GET") {
      if (isAdmin || boot) return J(200, { cfg: cfg || null });
      // un employé ne reçoit jamais les clés des autres ; "st" lui dit si sa propre clé a été changée ou retirée
      const users = cfg.users.map((u) => ({ id: u.id, nom: u.nom, role: u.role, perms: u.perms || null, pin: who && u.id === who.id ? u.pin : (u.pin ? "!" : null) }));
      return J(200, { cfg: { users, rev: cfg.rev }, st: uid ? (who ? "ok" : "stale") : null });
    }

    if (a === "cfg" && req.method === "PUT") {
      if (!isAdmin && !boot) return J(403, { error: "Réservé à l'administrateur" });
      const b = await req.json();
      if (!b || !Array.isArray(b.users) || !b.users.length || b.users.length > 50) return J(400, { error: "Configuration invalide" });
      const users = b.users.map((u) => ({
        id: String(u.id).slice(0, 20), nom: String(u.nom || "").slice(0, 30),
        role: u.role === "admin" ? "admin" : "employe", pin: u.pin ? String(u.pin).slice(0, 80) : null,
        perms: u.perms && typeof u.perms === "object" ? u.perms : null, off: !!u.off,
      }));
      if (!users.some((u) => u.role === "admin" && u.pin)) return J(400, { error: "Il faut un administrateur avec une clé d'accès" });
      const pins = users.filter((u) => u.pin).map((u) => u.pin);
      if (pins.some((x) => x === "!") || new Set(pins).size !== pins.length) return J(400, { error: "Deux utilisateurs ont la même clé d'accès" });
      await store.setJSON("cfg", { users, rev: Date.now() });
      return J(200, { ok: true });
    }

    /* ---------- Données partagées : un espace par utilisateur (u/<id>), réglages (set), espace admin (adm), compteurs (seq) ---------- */
    const mustAuth = () => (who ? null : J(401, { error: "Connexion requise" }));
    const OKK = ["docs", "clients"];

    if (a === "push" && req.method === "POST") {
      const e0 = mustAuth(); if (e0) return e0;
      const b = await req.json();
      const recs = Array.isArray(b.recs) ? b.recs.slice(0, 60) : [];
      const byOwner = {};
      for (const r of recs) {
        if (!r || !OKK.includes(r.k) || !Number.isFinite(+r.id) || !r.data || typeof r.data !== "object") continue;
        if (JSON.stringify(r.data).length > 300000) continue;
        const o = isAdmin && r.o ? String(r.o).slice(0, 20) : who.id;
        if (!isAdmin && r.o && r.o !== who.id) continue;
        (byOwner[o] = byOwner[o] || []).push(r);
      }
      const revs = {};
      for (const o of Object.keys(byOwner)) {
        const blob = await cas(store, "u/" + o, () => ({ rev: 0, docs: {}, clients: {} }), (b) => {
          b.docs = b.docs || {}; b.clients = b.clients || {};
          for (const r of byOwner[o]) b[r.k][String(r.id)] = r.data;
          b.rev = Math.max(Date.now(), (b.rev || 0) + 1);
          return b;
        });
        revs[o] = blob.rev;
      }
      const out = { ok: true, revs };
      if (isAdmin && b.set && typeof b.set === "object") {
        const rev = Date.now();
        await store.setJSON("set", { rev, data: b.set }); out.setRev = rev;
      }
      if (isAdmin && b.adm && typeof b.adm === "object") {
        const rev = Date.now();
        await store.setJSON("adm", { rev, emp: b.adm.emp || [], ent: b.adm.ent || [], rel: b.adm.rel || [] }); out.admRev = rev;
      }
      return J(200, out);
    }

    if (a === "pull" && req.method === "GET") {
      const e0 = mustAuth(); if (e0) return e0;
      let known = {}; try { known = JSON.parse(url.searchParams.get("revs") || "{}"); } catch {}
      let owners = [who.id];
      if (isAdmin) { const l = await store.list({ prefix: "u/" }); owners = l.blobs.map((x) => x.key.slice(2)); }
      const blobs = {};
      for (const o of owners) {
        const bl = await store.get("u/" + o, { type: "json" });
        if (bl && bl.rev !== known[o]) blobs[o] = bl;
      }
      const st = await store.get("set", { type: "json" });
      if (st && st.rev !== known.__set) blobs.__set = st;
      if (isAdmin) { const ad = await store.get("adm", { type: "json" }); if (ad && ad.rev !== known.__adm) blobs.__adm = ad; }
      return J(200, { blobs });
    }

    if (a === "seq" && req.method === "POST") {
      const e0 = mustAuth(); if (e0) return e0;
      const b = await req.json();
      if (b.init) {
        if (!isAdmin) return J(403, { error: "Réservé à l'administrateur" });
        await cas(store, "seq", () => ({ init: false, c: {} }), (cur) => {
          for (const k of Object.keys(b.floors || {})) if (/^(devis|facture)\d{4}$/.test(k)) cur.c[k] = Math.max(cur.c[k] || 0, +b.floors[k] || 0);
          cur.init = true;
          return cur;
        });
        return J(200, { ok: true });
      }
      const chk = await store.get("seq", { type: "json" });
      if (!chk || !chk.init) return J(409, { error: "noinit" });
      if (!["devis", "facture"].includes(b.type) || !(+b.year >= 2000 && +b.year <= 2100)) return J(400, { error: "Requête invalide" });
      const n = Math.min(Math.max(+b.n || 1, 1), 50), k = b.type + (+b.year);
      let from = 0;
      const cur = await cas(store, "seq", () => ({ init: true, c: {} }), (c) => {
        from = (c.c[k] || 0) + 1;
        c.c[k] = from + n - 1;
        return c;
      });
      return J(200, { from, to: cur.c[k] });
    }

    if (a === "log" && req.method === "POST") {
      const b = await req.json();
      const ev = Array.isArray(b.events) ? b.events.slice(0, 100) : [];
      let n = 0;
      for (const e of ev) {
        if (!e || !e.id || !e.t || !e.a) continue;
        const rec = {
          id: String(e.id).slice(0, 40), t: String(e.t).slice(0, 30), u: String(e.u || "").slice(0, 20),
          n: String(e.n || "").slice(0, 40), a: String(e.a).slice(0, 20), d: String(e.d || "").slice(0, 300),
          m: Number(e.m) || 0, dev: String(e.dev || "").slice(0, 30),
          v: !!who && who.id === e.u, // vrai si l'événement vient d'un appareil dont le code a été vérifié
        };
        await store.setJSON(`log/${rec.t}_${rec.id}`, rec);
        n++;
      }
      return J(200, { ok: true, n });
    }

    if (a === "log" && req.method === "GET") {
      if (!isAdmin) return J(403, { error: "Réservé à l'administrateur" });
      const days = Math.min(Math.max(+url.searchParams.get("days") || 31, 1), 366);
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const months = new Set();
      for (let i = 0; i <= days; i += 15) months.add(new Date(Date.now() - i * 864e5).toISOString().slice(0, 7));
      months.add(since.slice(0, 7));
      let keys = [];
      for (const m of months) {
        const r = await store.list({ prefix: `log/${m}` });
        keys = keys.concat(r.blobs.map((b) => b.key));
      }
      keys = [...new Set(keys)].filter((k) => k.slice(4) >= since).sort().reverse().slice(0, 1500);
      const out = [];
      for (let i = 0; i < keys.length; i += 25) {
        const part = await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" })));
        part.forEach((p) => p && out.push(p));
      }
      return J(200, { events: out });
    }
    return J(404, { error: "Action inconnue" });
  } catch (err) {
    return J(500, { error: String(err && err.message || err) });
  }
};

export const config = { path: "/api/ctl" };
