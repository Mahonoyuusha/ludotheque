(() => {
  const state = {
    games: [],
    filtered: [],
    view: 'home', // 'home' | 'owned' | 'wishlist'
  };

  const el = {
    toolbarRight: document.getElementById('toolbar-right'),
    galerie: document.getElementById('galerie'),
    search: document.getElementById('searchInput'),
    toolbarLeft: document.getElementById('toolbar-left'),
    homeLink: document.getElementById('homeLink'),
    ownedLink: document.getElementById('ownedLink'),
    wishlistLink: document.getElementById('wishlistLink'),
    modal: document.getElementById('modale-jeu'),
    modalBackdrop: document.getElementById('modale-backdrop'),
    modalClose: document.getElementById('modale-close'),
    modalContent: document.getElementById('modale-content'),
  };

  async function fetchGames() {
    try {
      const res = await fetch('/games');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.games = Array.isArray(data) ? data : [];
      computeFilter();
      render();
    } catch (e) {
      console.error('Erreur de chargement des jeux:', e);
      if (el.galerie) el.galerie.innerHTML = '<p class="error">Impossible de charger les jeux. Vérifiez que l\'API est démarrée.</p>';
    }
  }

  function computeFilter() {
    if (state.view === 'home') { state.filtered = []; return; }
    const list = state.games.filter((g) => state.view === 'owned' ? !!g.possessed : !!g.wishlisted);
    const q = (el.search?.value || '').toLowerCase();
    state.filtered = !q ? list : list.filter((g) => {
      const name = (g.name || '').toLowerCase();
      const summary = (g.summary || '').toLowerCase();
      const tags = [...(g.genre_gameplay || []), ...(g.genre_universe || [])]
        .join(' ')
        .toLowerCase();
      return name.includes(q) || summary.includes(q) || tags.includes(q);
    });
  }

  function render() {
    renderToolbar();
    if (!el.galerie) return;
    el.galerie.innerHTML = '';
    if (state.view === 'home') { renderHome(); return; }
    if (!state.filtered.length) { el.galerie.innerHTML = '<p>Aucun jeu trouvé.</p>'; return; }
    for (const game of state.filtered) el.galerie.appendChild(card(game));
  }

  function renderToolbar() {
    if (!el.toolbarLeft) return;
    el.toolbarLeft.innerHTML = '';
    if (state.view === 'wishlist' || state.view === 'owned') {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-primary';
      addBtn.textContent = 'Ajouter un jeu';
      addBtn.addEventListener('click', (e) => { e.preventDefault(); openAddGameModal(); });
      el.toolbarLeft.appendChild(addBtn);
    }
    if (state.view === 'owned') {
      const randBtn = document.createElement('button');
      randBtn.className = 'btn-secondary';
      randBtn.textContent = 'Aléatoire';
      randBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!state.filtered.length) return;
        const idx = Math.floor(Math.random() * state.filtered.length);
        openModal(state.filtered[idx]);
      });
      el.toolbarLeft.appendChild(randBtn);
    }
  }

  function renderHome() {
    const div = document.createElement('div');
    div.className = 'landing';
    div.innerHTML = `
      <div class="intro">
        <h2>Bienvenue</h2>
        <p>Organisez votre passion du jeu: gérez votre propre ludothèque et gardez une wishlist claire des jeux à découvrir. Ajoutez de nouveaux titres via l'IA, consultez les informations utiles et passez du souhaité au possédé en un clic.</p>
      </div>
      <div class="landing-cards">
        <a href="#ludotheque" id="go-owned" class="landing-card">
          <h3>Ma Ludothèque</h3>
          <p>Voir et gérer vos jeux possédés.</p>
        </a>
        <a href="#wishlist" id="go-wishlist" class="landing-card">
          <h3>Wishlist</h3>
          <p>Suivre les jeux que vous souhaitez acquérir.</p>
        </a>
      </div>`;
    el.galerie.appendChild(div);
    div.querySelector('#go-owned')?.addEventListener('click', (e) => { e.preventDefault(); setView('owned'); });
    div.querySelector('#go-wishlist')?.addEventListener('click', (e) => { e.preventDefault(); setView('wishlist'); });
  }

  function setView(v) {
    state.view = v;
    location.hash = v === 'owned' ? '#ludotheque' : (v === 'wishlist' ? '#wishlist' : '#home');
    computeFilter();
    render();
  }

  function card(game) {
    const div = document.createElement('div');
    div.className = 'carte';
    div.tabIndex = 0;
    div.addEventListener('click', () => openModal(game));
    div.addEventListener('keypress', (e) => { if (e.key === 'Enter') openModal(game); });

    const img = document.createElement('img');
    img.className = 'carte-img';
    img.alt = game.name || 'Jeu';
    img.loading = 'lazy';
    img.src = game.image_url || 'https://via.placeholder.com/320x180?text=Jeu';

    const h3 = document.createElement('h3');
    h3.className = 'carte-title';
    h3.textContent = game.name || 'Sans nom';

    const p = document.createElement('p');
    p.className = 'carte-summary';
    const summary = (game.summary || '').trim();
    p.textContent = summary.length > 160 ? summary.slice(0, 157) + '…' : summary;

    const meta = document.createElement('div');
    meta.className = 'carte-meta';
    const players = [game.players_min, game.players_max].filter((n) => n != null).join('–');
    const duration = game.duration || '';
    meta.textContent = [players ? `${players} joueurs` : null, duration].filter(Boolean).join(' • ');

    const actions = document.createElement('div');
    actions.className = 'carte-actions';
    if (game.wishlisted) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-primary';
      addBtn.textContent = 'Ajouter à ma ludothèque';
      addBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateGameState(game.id, { possessed: true, wishlisted: false });
      });
      actions.appendChild(addBtn);
    } else if (!game.possessed) {
      const wlBtn = document.createElement('button');
      wlBtn.className = 'btn-secondary';
      wlBtn.textContent = 'Ajouter à la wishlist';
      wlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateGameState(game.id, { wishlisted: true });
      });
      actions.appendChild(wlBtn);
    }
    if (game.possessed || game.wishlisted) {
      const binBtn = document.createElement('button');
      binBtn.className = 'btn-secondary';
      binBtn.title = 'Retirer de la liste';
      binBtn.textContent = '🗑️';
      binBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (game.possessed) {
          await updateGameState(game.id, { possessed: false });
        } else if (game.wishlisted) {
          await updateGameState(game.id, { wishlisted: false });
        }
      });
      actions.appendChild(binBtn);
    }

    div.append(img, h3, p, meta, actions);
    return div;
  }

  function showModal(html) {
    el.modalContent.innerHTML = html;
    el.modal.classList.remove('hidden');
    el.modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function openModal(game) {
    showModal(`
      <div class="game-detail">
        <div class="game-hero">
          <img src="${game.image_url || 'https://via.placeholder.com/640x360?text=Jeu'}" alt="${escapeHtml(game.name || 'Jeu')}" />
        </div>
        <div class="game-body">
          <h2>${escapeHtml(game.name || 'Sans nom')}</h2>
          <p>${escapeHtml(game.summary || 'Aucune description')}</p>
          <div class="game-grid">
            <div><strong>Joueurs:</strong> ${(game.players_min ?? '?')}–${(game.players_max ?? '?')}</div>
            <div><strong>Durée:</strong> ${escapeHtml(game.duration || 'N/A')}</div>
            <div><strong>Coopératif:</strong> ${game.is_coop ? 'Oui' : 'Non'}</div>
            <div><strong>Langues:</strong> ${(Array.isArray(game.languages) ? game.languages : []).join(', ') || 'N/A'}</div>
          </div>
          <div class="tags">
            ${(Array.isArray(game.genre_gameplay) ? game.genre_gameplay : []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
            ${(Array.isArray(game.genre_universe) ? game.genre_universe : []).map(t => `<span class="tag tag-alt">${escapeHtml(t)}</span>`).join('')}
          </div>
          <div class="prices">
            ${game.price_philibert != null ? `<span>Philibert: ${game.price_philibert}€</span>` : ''}
          </div>
          <div class="links">
            ${game.links?.philibert ? `<a href="${escapeAttr(game.links.philibert)}" target="_blank" rel="noopener">Voir sur Philibert</a>` : ''}
          </div>
          <div class="links">
            ${game.rules_pdf_url ? `<a href="${escapeAttr(game.rules_pdf_url)}" target="_blank" class="btn-secondary">Règles (PDF)</a>` : `<a href="#" aria-disabled="true" class="btn-secondary" style="pointer-events:none; opacity:.7">Règles (PDF) – placeholder</a>`}
          </div>
          <ul class="rules">
            ${(Array.isArray(game.rules) ? game.rules : []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>
      </div>`);
  }

  function openAddGameModal() {
    showModal(`
      <form id="addGameForm">
        <h2>Ajouter un jeu</h2>
        <label for="gameName">Nom du jeu</label>
        <input id="gameName" name="name" type="text" required class="search" style="width:100%; margin:.5rem 0 1rem" placeholder="ex: Azul, 7 Wonders, Dixit..." />
        <div style="display:flex; gap:.5rem; margin-top:.5rem">
          <button type="submit" id="aiAddBtn" class="btn-primary">Remplir avec l'IA</button>
          <button type="button" id="cancelAddBtn" class="btn-secondary">Annuler</button>
        </div>
        <p id="aiStatus" class="carte-meta" style="margin-top:.75rem"></p>
      </form>
    `);

    const form = document.getElementById('addGameForm');
    const aiBtn = document.getElementById('aiAddBtn');
    const cancelBtn = document.getElementById('cancelAddBtn');
    const status = document.getElementById('aiStatus');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = new FormData(form).get('name');
      if (!name) return;
      aiBtn.disabled = true;
      status.textContent = "Je réfléchis et collecte les infos...";
      try {
        const res = await fetch('/games/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target: (state.view === 'owned' ? 'owned' : 'wishlist') })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
        status.textContent = 'Ajouté !';
        closeModal();
        fetchGames();
      } catch (err) {
        console.error(err);
        status.textContent = "Échec de l'ajout. Vérifiez l'API.";
        aiBtn.disabled = false;
      }
    });
    cancelBtn.addEventListener('click', closeModal);
  }

  function closeModal() {
    el.modal.classList.add('hidden');
    el.modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function escapeHtml(s) {
    return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }
  function escapeAttr(s) {
    return String(s).replaceAll('"', '&quot;');
  }

  // Events
  el.search?.addEventListener('input', () => { computeFilter(); render(); });

  el.homeLink?.addEventListener('click', (e) => { e.preventDefault(); setView('home'); });
  el.ownedLink?.addEventListener('click', (e) => { e.preventDefault(); setView('owned'); });
  el.wishlistLink?.addEventListener('click', (e) => { e.preventDefault(); setView('wishlist'); });

  el.modalBackdrop?.addEventListener('click', closeModal);
  el.modalClose?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  async function updateGameState(id, payload) {
    try {
      const res = await fetch(`/games/${id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await fetchGames();
    } catch (e) {
      console.error('updateGameState failed', e);
      alert("Impossible de mettre à jour l'état du jeu.");
    }
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    const h = location.hash.replace('#','');
    if (h === 'ludotheque') state.view = 'owned';
    else if (h === 'wishlist') state.view = 'wishlist';
    else state.view = 'home';
    fetchGames();
  });
})();



