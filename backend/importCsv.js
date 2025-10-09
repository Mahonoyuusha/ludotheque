const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const pool = require('./db');

// Chemin du fichier CSV
const csvFilePath = path.resolve(__dirname, 'ludotheque.csv');

// Helpers
const parseList = (str) => {
  if (!str) return [];
  return String(str)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseRules = (str) => {
  if (!str) return [];
  return String(str)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseIntSafe = (val) => {
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? null : n;
};

const parsePrice = (price) => {
  if (price == null) return null;
  const normalized = String(price).replace(/\s/g, '').replace(',', '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
};

async function ensureSchema() {
  try {
    await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS possessed BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS wishlisted BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS rules_pdf_url TEXT");
  } catch (e) {
    console.error('ensureSchema error', e.message);
  }
}

// Fonction d'import principal
async function importGamesFromCSV() {
  await ensureSchema();
  const results = [];

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      try {
        const toBool = (s) => {
          const t = String(s || '').trim().toLowerCase();
          return ['oui','yes','true','1','x','possede','possédé'].includes(t);
        };
        const possessed = toBool(row.possessed || row.owned);
        const wishlisted = row.wishlisted != null ? (toBool(row.wishlisted) ? true : false) : !possessed;
        results.push({
          name: (row.game_name || '').trim(),
          image_url: row.image_url ? String(row.image_url).trim() : null,
          summary: row.summary ? String(row.summary).trim() : null,
          rules: parseRules(row.rules),
          players_min: parseIntSafe(row.nb_min_player),
          players_max: parseIntSafe(row.nb_max_player),
          duration: row.duration ? String(row.duration).trim() : null,
          genre_gameplay: parseList(row.tags_gameplay),
          genre_universe: parseList(row.tags_univers),
          is_coop: String(row.tags_gameplay || '').toLowerCase().includes('coop'),
          languages: ['FR'],
          price_amazon: parsePrice(row.prix_amazon),
          price_philibert: parsePrice(row.prix_philibert),
          links: {
            amazon: row.lien_amazon || null,
            philibert: row.lien_philibert || null,
          },
          possessed,
          wishlisted,
          rules_pdf_url: null,
        });
      } catch (e) {
        console.error('Erreur de parsing de ligne CSV:', e.message);
      }
    })
    .on('error', (err) => {
      console.error('Erreur de lecture du CSV:', err.message);
    })
    .on('end', async () => {
      console.log(`Insertion de ${results.length} jeux...`);

      for (const game of results) {
        try {
          await pool.query(
            `INSERT INTO games (
              name, image_url, summary, rules, players_min, players_max, duration,
              genre_gameplay, genre_universe, is_coop, languages,
              price_philibert, price_amazon, links,
              possessed, wishlisted, rules_pdf_url
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
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
              game.possessed,
              game.wishlisted,
              game.rules_pdf_url,
            ]
          );
          console.log(`Inséré: ${game.name}`);
        } catch (error) {
          console.error(`Erreur pour ${game.name}:`, error.message);
        }
      }

      console.log('Importation terminée.');
      await pool.end();
    });
}

importGamesFromCSV();
