// Envoie un PDF + message à un client via l'API WhatsApp Business (Cloud API de Meta).
// Variables d'environnement Netlify : WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE, WA_LANG (défaut fr), APP_KEY
const rep = (code, msg) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: typeof msg === 'string' ? msg : JSON.stringify(msg) });

exports.handler = async (e) => {
  if (e.httpMethod !== 'POST') return rep(405, { error: 'Méthode refusée' });
  if (!process.env.APP_KEY || (e.headers['x-app-key'] || '') !== process.env.APP_KEY) return rep(401, { error: 'Clé invalide' });
  let b; try { b = JSON.parse(e.body || '{}'); } catch { return rep(400, { error: 'Requête illisible' }); }
  const { to, name, doc, num, pdf, filename } = b;
  if (!/^\d{8,15}$/.test(to || '') || !pdf) return rep(400, { error: 'Numéro ou PDF manquant' });

  const G = 'https://graph.facebook.com/v21.0/' + process.env.WA_PHONE_ID;
  const H = { Authorization: 'Bearer ' + process.env.WA_TOKEN };
  try {
    // 1) envoyer le PDF à WhatsApp
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', 'application/pdf');
    fd.append('file', new Blob([Buffer.from(pdf, 'base64')], { type: 'application/pdf' }), filename || 'document.pdf');
    const up = await (await fetch(G + '/media', { method: 'POST', headers: H, body: fd })).json();
    if (!up.id) return rep(502, { error: 'Envoi du PDF refusé', detail: up });
    // 2) envoyer le message (modèle approuvé) avec le PDF en en-tête
    const body = {
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: process.env.WA_TEMPLATE, language: { code: process.env.WA_LANG || 'fr' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: up.id, filename: filename || 'document.pdf' } }] },
          { type: 'body', parameters: [name, doc, num].map(t => ({ type: 'text', text: String(t || '') })) }
        ]
      }
    };
    const s = await (await fetch(G + '/messages', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    return s.messages ? rep(200, { ok: true }) : rep(502, { error: 'Message refusé', detail: s });
  } catch (err) { return rep(500, { error: String(err) }); }
};
