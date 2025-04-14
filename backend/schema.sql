CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  summary TEXT,
  rules TEXT[], -- un tableau de phrases
  players_min INT,
  players_max INT,
  duration TEXT,
  genre_gameplay TEXT[], -- ex : ['stratégie', 'coop']
  genre_universe TEXT[], -- ex : ['médiéval', 'fantasy']
  is_coop BOOLEAN,
  languages TEXT[], -- ex : ['FR', 'EN']
  price_philibert NUMERIC,
  price_amazon NUMERIC,
  links JSONB, -- { "amazon": "...", "philibert": "..." }
  qr_code_url TEXT
);
