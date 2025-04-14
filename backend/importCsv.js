const fs = require('fs');
const csv = require('csv-parser');
const pool = require('./db');

// Chemin du fichier CSV
const csvFilePath = 'backend/ludotheque.csv';

// Fonction pour convertir une string CSV en tableau
const parseList = (str) => str ? str.split(',').map(s => s.trim()) : [];

// Fonction pour transformer un prix en nombre
const parsePrice = (price) => {
  if (!price || typeof price !== 'string') return null;
  return parseFloat(price.replace(',', '.').replace('€', '').trim());
};

// Fonction d'import principal
async function importGamesFromCSV() {
  const results = [];

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      results.push({
        name: row.game_name,
        summary: row.summary,
        rules: parseList(row.rules),
        players_min: parseInt(row.nb_min_player),
        players_max: parseInt(row.nb_max_player),
        duration: row.duration,
        genre_gameplay: parseList(row.tags_gameplay),
        genre_universe: parseList(row.tags_univers),
        is_coop: row.tags_gameplay.toLowerCase().includes("coop"),
        languages: ['FR'], // tu peux rendre ça dynamique plus tard
        price_amazon: parsePrice(row.prix_amazon),
        price_philibert: parsePrice(row.prix_philibert),
        links: {
          amazon: row.lien_amazon,
          philibert: row.lien_philibert
        }
      });
    })
    .on('end', async () => {
      console.log(`📦 Insertion de ${results.length} jeux...`);

      for (const game of results) {
        try {
          await pool.query(
            `INSERT INTO games (
              name, summary, rules, players_min, players_max, duration,
              genre_gameplay, genre_universe, is_coop, languages,
              price_amazon, price_philibert, links
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              game.name,
              game.summary,
              game.rules,
              game.players_min,
              game.players_max,
              game.duration,
              game.genre_gameplay,
              game.genre_universe,
              game.is_coop,
              game.languages,
              game.price_amazon,
              game.price_philibert,
              game.links
            ]
          );
          console.log(`✅ Inséré : ${game.name}`);
        } catch (error) {
          console.error(`❌ Erreur pour ${game.name} :`, error.message);
        }
      }

      console.log('🎉 Importation terminée !');
      pool.end();
    });
}

importGamesFromCSV();
