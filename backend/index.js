const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
require('dotenv').config({ path: __dirname + '/.env' });

const app = express();

// Ensure schema (add columns if missing)
async function ensureSchema() {
  try {
    await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS possessed BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS wishlisted BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS rules_pdf_url TEXT");
  } catch (e) {
    console.error('ensureSchema error', e.message);
  }
}
ensureSchema();

// Middleware
app.use(cors());
app.use(express.json());

// Simple admin auth for hidden endpoints
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
function adminAuth(req, res, next) {
  if (!ADMIN_SECRET) return res.status(403).json({ error: 'ADMIN_SECRET non configurée' });
  const provided = req.get('x-admin-secret') || req.query.secret || '';
  if (provided !== ADMIN_SECRET) return res.status(401).json({ error: 'Non autorisé' });
  next();
}
// All /admin endpoints require the secret
app.use('/admin', adminAuth);

// API routes
app.get('/games', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/games/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Jeu introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

// Seed wishlist with existing games (all non-owned become wishlisted)
app.post('/admin/seed-wishlist', async (req, res) => {
  try {
    const r = await pool.query("UPDATE games SET wishlisted = true WHERE COALESCE(possessed,false) = false");
    res.json({ updated: r.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'seed wishlist échoué' });
  }
});

// Update game state (possessed / wishlisted)
app.patch('/games/:id/state', async (req, res) => {
  try {
    const { id } = req.params;
    const { possessed, wishlisted } = req.body || {};
    const fields = [];
    const values = [];
    let idx = 1;
    if (typeof possessed === 'boolean') { fields.push(`possessed = $${idx++}`); values.push(possessed); }
    if (typeof wishlisted === 'boolean') { fields.push(`wishlisted = $${idx++}`); values.push(wishlisted); }
    if (!fields.length) return res.status(400).json({ error: 'aucun champ à mettre à jour' });
    values.push(id);
    const q = `UPDATE games SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await pool.query(q, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Jeu introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mise à jour échouée' });
  }
});

// Backfill images from product pages (og:image)
app.post('/admin/backfill-images', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.body?.limit ?? '20', 10) || 20, 200);
    const { rows } = await pool.query(
      `SELECT id, links FROM games 
       WHERE (image_url IS NULL OR image_url = '') 
         AND links IS NOT NULL 
         AND ((links->>'amazon') IS NOT NULL OR (links->>'philibert') IS NOT NULL)
       LIMIT $1`,
      [limit]
    );
    let updated = 0;
    for (const r of rows) {
      const url = r.links?.philibert || r.links?.amazon;
      if (!url) continue;
      try {
        const htmlResp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!htmlResp.ok) continue;
        const html = await htmlResp.text();
        const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
        let img = null;
        if (m) {
          const tag = m[0];
          const cm = tag.match(/content=["']([^"']+)["']/i);
          if (cm) img = cm[1];
        }
        if (img) {
          await pool.query('UPDATE games SET image_url = $1 WHERE id = $2', [img, r.id]);
          updated++;
        }
      } catch (_) {
        // ignore
      }
    }
    res.json({ scanned: rows.length, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Backfill images échoué' });
  }
});

// Backfill images using BoardGameGeek XML API (fallback by name)
app.post('/admin/backfill-images-bgg', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.body?.limit ?? '20', 10) || 20, 200);
    const { rows } = await pool.query(
      `SELECT id, name FROM games
       WHERE (image_url IS NULL OR image_url = '')
       ORDER BY id ASC
       LIMIT $1`,
      [limit]
    );
    let updated = 0;
    const headers = { 'User-Agent': 'ludotheque/1.0 (backfill)' };
    for (const r of rows) {
      const name = (r.name || '').trim();
      if (!name) continue;
      try {
        const q = encodeURIComponent(name);
        const searchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${q}&type=boardgame`; // non-exact to widen matches
        const sResp = await fetch(searchUrl, { headers });
        if (!sResp.ok) continue;
        const sXml = await sResp.text();
        const idMatch = sXml.match(/<item[^>]*id="(\d+)"[^>]*>/i);
        if (!idMatch) continue;
        const id = idMatch[1];
        const thingUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${id}`;
        const tResp = await fetch(thingUrl, { headers });
        if (!tResp.ok) continue;
        const tXml = await tResp.text();
        const imgMatch = tXml.match(/<image>([^<]+)<\/image>/i);
        if (!imgMatch) continue;
        const img = imgMatch[1];
        if (img) {
          await pool.query('UPDATE games SET image_url = $1 WHERE id = $2', [img, r.id]);
          updated++;
        }
      } catch (_) {
        // ignore per item
      }
    }
    res.json({ scanned: rows.length, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Backfill images BGG échoué' });
  }
});

// Patch certain fields of a game (admin only)
app.patch('/admin/games/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    // Whitelist of editable fields
    const allowed = {
      name: (v) => v == null ? null : String(v),
      image_url: (v) => v == null ? null : String(v),
      summary: (v) => v == null ? null : String(v),
      rules_pdf_url: (v) => v == null ? null : String(v),
      duration: (v) => v == null ? null : String(v),
      players_min: (v) => Number.isInteger(v) ? v : (v == null ? null : parseInt(v,10) || null),
      players_max: (v) => Number.isInteger(v) ? v : (v == null ? null : parseInt(v,10) || null),
      possessed: (v) => typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true',
      wishlisted: (v) => typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true',
      price_philibert: (v) => (v == null ? null : parseFloat(v)),
      // Only keep philibert link; sanitize object shape
      links: (v) => {
        if (!v) return null;
        try {
          const obj = typeof v === 'string' ? JSON.parse(v) : v;
          return { philibert: obj.philibert || null };
        } catch { return null; }
      },
      genre_gameplay: (v) => Array.isArray(v) ? v : null,
      genre_universe: (v) => Array.isArray(v) ? v : null,
      languages: (v) => Array.isArray(v) ? v : null,
      rules: (v) => Array.isArray(v) ? v : null,
    };

    const fields = [];
    const values = [];
    let i = 1;
    for (const key of Object.keys(allowed)) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        fields.push(`${key} = $${i}`);
        values.push(allowed[key](body[key]));
        i++;
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Aucun champ autorisé fourni' });
    values.push(id);
    const q = `UPDATE games SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
    const result = await pool.query(q, values);
    if (!result.rows.length) return res.status(404).json({ error: 'Jeu introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Mise à jour échouée' });
  }
});

// Use OpenAI to fill missing fields (image_url, links.philibert, price_philibert)
app.post('/admin/games/:id/ai', async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY non configurée' });

    const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Jeu introuvable' });
    const g = rows[0];

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const system = `Tu es une IA qui complète des fiches de jeux de société. Retourne UNIQUEMENT un JSON (pas de texte) avec ces champs:
{
  "image_url": string|null,
  "price_philibert": number|null,
  "links": { "philibert": string|null }
}
Règles:
- Donne un lien direct produit Philibert si trouvable, sinon null.
- Laisse Amazon vide (on ne l'utilise pas).
- Donne une image produit de bonne qualité si possible.
- Prix: nombre (en euros, décimale avec point).`;
    const user = `Nom: ${g.name}\nRésumé: ${(g.summary || '').slice(0, 500)}\nRenseigne image_url, links.philibert et price_philibert.`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, response_format: { type: 'json_object' }, temperature: 0.2, messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]}),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return res.status(502).json({ error: 'Erreur OpenAI', status: resp.status, detail: t });
    }
    const data = await resp.json();
    let out; try { out = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { out = {}; }

    const image_url = out.image_url ?? null;
    const price_philibert = typeof out.price_philibert === 'number' ? out.price_philibert : null;
    const link_phili = out.links && typeof out.links === 'object' ? (out.links.philibert ?? null) : null;

    const fields = [];
    const values = [];
    let i = 1;
    if (image_url) { fields.push(`image_url = $${i++}`); values.push(image_url); }
    if (price_philibert != null) { fields.push(`price_philibert = $${i++}`); values.push(price_philibert); }
    if (link_phili != null) { fields.push(`links = jsonb_set(COALESCE(links,'{}'::jsonb), '{philibert}', to_jsonb($${i}))`); values.push(link_phili); i++; }
    if (!fields.length) return res.json({ updated: 0, message: 'Aucun champ proposé' });
    values.push(id);
    const q = `UPDATE games SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;
    const r2 = await pool.query(q, values);
    res.json({ updated: 1, game: r2.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'IA fill échoué' });
  }
});

// Create a game manually
app.post('/games', async (req, res) => {
  try {
    const g = req.body || {};
    const q = `INSERT INTO games (
      name, image_url, summary, rules, players_min, players_max, duration,
      genre_gameplay, genre_universe, is_coop, languages,
      price_philibert, price_amazon, links, qr_code_url
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;
    const vals = [
      g.name,
      g.image_url ?? null,
      g.summary ?? null,
      Array.isArray(g.rules) ? g.rules : null,
      g.players_min ?? null,
      g.players_max ?? null,
      g.duration ?? null,
      Array.isArray(g.genre_gameplay) ? g.genre_gameplay : null,
      Array.isArray(g.genre_universe) ? g.genre_universe : null,
      typeof g.is_coop === 'boolean' ? g.is_coop : null,
      Array.isArray(g.languages) ? g.languages : null,
      g.price_philibert ?? null,
      g.price_amazon ?? null,
      g.links ?? null,
      g.qr_code_url ?? null,
    ];
    const result = await pool.query(q, vals);
    const inserted = result.rows[0];
    // Set list based on target (owned/wishlist)
    if (target === 'owned') {
      try { await pool.query('UPDATE games SET possessed = true, wishlisted = false WHERE id = $1', [inserted.id]); inserted.possessed = true; inserted.wishlisted = false; } catch (_) {}
    } else {
      try { await pool.query('UPDATE games SET wishlisted = true, possessed = false WHERE id = $1', [inserted.id]); inserted.wishlisted = true; inserted.possessed = false; } catch (_) {}
    }
    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Insertion échouée' });
  }
});

// Create a game using AI to fill details
app.post('/games/ai', async (req, res) => {
  try {
    const { name, target } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name requis' });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY non configurée' });

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const system = `Tu es une IA experte en jeux de société. Retourne UNIQUEMENT un JSON valide (pas de texte autour) respectant ce schéma:
{
  "name": string,
  "image_url": string|null,
  "summary": string, // en français, 2-4 phrases
  "rules": string[], // 3-6 règles clés, courtes
  "players_min": number|null,
  "players_max": number|null,
  "duration": string|null, // ex: "30–45 min"
  "genre_gameplay": string[], // tags de gameplay
  "genre_universe": string[], // tags d’univers
  "is_coop": boolean,
  "languages": string[], // ex: ["FR","EN"]
  "price_philibert": number|null,
  "price_amazon": number|null,
  "links": { "amazon": string|null, "philibert": string|null }
}
Contraintes: 
- Utilise des sources fiables si possible.
- Donne des liens directs produit (Philibert, Amazon) si trouvables.
- Si tu n’es pas sûr: mets null pour le prix/lien.
- N’invente pas des prix irréalistes.`;

    const user = `Jeu: ${name}\nRenseigne les champs précisément. Privilégie le contenu en français.`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.error('OpenAI error', resp.status, t);
      return res.status(502).json({ error: 'Erreur OpenAI', status: resp.status });
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'Réponse OpenAI invalide' });
    let g;
    try {
      g = JSON.parse(content);
    } catch (e) {
      console.error('JSON parse error', e);
      return res.status(502).json({ error: 'JSON OpenAI invalide' });
    }

    // Normalize fields
    const game = {
      name: g.name || name,
      image_url: g.image_url ?? null,
      summary: g.summary ?? null,
      rules: Array.isArray(g.rules) ? g.rules.slice(0, 12) : null,
      players_min: Number.isInteger(g.players_min) ? g.players_min : null,
      players_max: Number.isInteger(g.players_max) ? g.players_max : null,
      duration: g.duration ?? null,
      genre_gameplay: Array.isArray(g.genre_gameplay) ? g.genre_gameplay.slice(0, 12) : null,
      genre_universe: Array.isArray(g.genre_universe) ? g.genre_universe.slice(0, 12) : null,
      is_coop: typeof g.is_coop === 'boolean' ? g.is_coop : null,
      languages: Array.isArray(g.languages) ? g.languages.slice(0, 5) : null,
      price_philibert: typeof g.price_philibert === 'number' ? g.price_philibert : null,
      price_amazon: typeof g.price_amazon === 'number' ? g.price_amazon : null,
      links: g.links && typeof g.links === 'object' ? {
        amazon: g.links.amazon ?? null,
        philibert: g.links.philibert ?? null,
      } : null,
      qr_code_url: null,
    };

    const q = `INSERT INTO games (
      name, image_url, summary, rules, players_min, players_max, duration,
      genre_gameplay, genre_universe, is_coop, languages,
      price_philibert, price_amazon, links, qr_code_url
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`;
    const vals = [
      game.name,
      game.image_url,
      game.summary,
      game.rules,
      game.players_min,
      game.players_max,
      game.duration,
      game.genre_gameplay,
      game.genre_universe,
      game.is_coop,
      game.languages,
      game.price_philibert,
      game.price_amazon,
      game.links,
      game.qr_code_url,
    ];
    const result = await pool.query(q, vals);
    const inserted = result.rows[0];
    // Default manual add goes to wishlist (can be changed later)
    try { await pool.query('UPDATE games SET wishlisted = true, possessed = false WHERE id = $1', [inserted.id]); inserted.wishlisted = true; inserted.possessed = false; } catch (_) {}
    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ajout IA échoué' });
  }
});

// Static frontend
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));
app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarrré sur http://localhost:${PORT}`);
});
