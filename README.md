Ma Ludothèque — API + Frontend statique
=======================================

L’application permet d’importer des jeux depuis un CSV dans PostgreSQL et d’afficher la liste via une page statique servie par Express.

Prérequis
- Node.js 18+
- PostgreSQL en local

Configuration
1) Renseignez les variables de connexion dans `backend/.env` (fichier déjà présent, à ne pas committer).
2) Créez la table:
   psql -d ludotheque -f backend/schema.sql
3) Importez les données CSV:
   node backend/importCsv.js

Démarrer
   npm start
Puis ouvrez http://localhost:3000

Notes
- L’API expose `GET /games` et `GET /games/:id`.
- Le frontend statique est servi depuis `frontend/`.
- Le parseur CSV gère les prix (€, espaces), les listes et les règles multi‑lignes.
