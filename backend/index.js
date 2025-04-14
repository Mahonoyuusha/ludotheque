const express = require('express');
const cors = require('cors');
const pool = require('./db');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/games', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM games');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});


app.use(express.json());

app.get('/', async (req, res) => {
  res.send('Bienvenue dans ta ludothèque 🧩');
});

app.listen(3000, () => {
  console.log('✅ Serveur démarré sur http://localhost:3000');
});
