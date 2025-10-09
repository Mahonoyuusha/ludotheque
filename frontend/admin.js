(() => {
  const el = {
    secret: document.getElementById('secretInput'),
    saveSecret: document.getElementById('saveSecretBtn'),
    secretStatus: document.getElementById('secretStatus'),
    filter: document.getElementById('filterSelect'),
    q: document.getElementById('q'),
    refresh: document.getElementById('refreshBtn'),
    seed: document.getElementById('seedBtn'),
    og: document.getElementById('ogBtn'),
    bgg: document.getElementById('bggBtn'),
    opStatus: document.getElementById('opStatus'),
    tbody: document.getElementById('tbody'),
  };

  const state = { games: [], filtered: [] };

  function getSecret() {
    return sessionStorage.getItem('ADMIN_SECRET') || '';
  }
  function setSecret(s) { sessionStorage.setItem('ADMIN_SECRET', s || ''); }

  async function load() {
    try {
      const res = await fetch('/games');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.games = Array.isArray(data) ? data : [];
      filter();
      render();
    } catch (e) {
      console.error(e);
      el.opStatus.textContent = 'Échec du chargement des jeux';
    }
  }

  function filter() {
    const mode = el.filter.value;
    const q = (el.q.value || '').toLowerCase();
    let list = state.games;
    if (mode === 'owned') list = list.filter(g => !!g.possessed);
    else if (mode === 'wishlist') list = list.filter(g => !!g.wishlisted);
    else if (mode === 'none') list = list.filter(g => !g.possessed && !g.wishlisted);
    if (q) list = list.filter(g => (g.name||'').toLowerCase().includes(q) || (g.summary||'').toLowerCase().includes(q));
    state.filtered = list;
  }

  function render() {
    el.tbody.innerHTML = '';
    for (const g of state.filtered) {
      el.tbody.appendChild(row(g));
    }
  }

  function input(type, value, attrs={}) {
    const i = document.createElement('input');
    i.type = type; if (value != null) i.value = value;
    for (const k of Object.keys(attrs)) i.setAttribute(k, attrs[k]);
    return i;
  }

  function row(g) {
    const tr = document.createElement('tr');
    const td = (...nodes) => { const c = document.createElement('td'); nodes.forEach(n => c.append(n)); return c; };

    const idCell = document.createElement('td'); idCell.textContent = g.id;

    const nameI = input('text', g.name || '', { 'aria-label': 'Nom' });
    const possI = input('checkbox', null); possI.checked = !!g.possessed;
    const wishI = input('checkbox', null); wishI.checked = !!g.wishlisted;
    const durI = input('text', g.duration || '', { 'aria-label': 'Durée' });
    const minI = input('number', g.players_min ?? '', { 'min':'0', 'aria-label': 'Min' });
    const maxI = input('number', g.players_max ?? '', { 'min':'0', 'aria-label': 'Max' });
    const pphiI = input('number', g.price_philibert ?? '', { 'min':'0', 'step':'0.01', 'aria-label': 'Prix Philibert' });
    const linkPhiI = input('text', g.links?.philibert || '', { 'aria-label': 'Lien Philibert' });
    const pdfI = input('text', g.rules_pdf_url || '', { 'aria-label': 'PDF règles' });
    const imgI = input('text', g.image_url || '', { 'aria-label': 'Image URL' });

    const status = document.createElement('span'); status.className = 'status';
    const saveBtn = document.createElement('button'); saveBtn.className = 'btn-primary'; saveBtn.textContent = 'Enregistrer';
    const aiBtn = document.createElement('button'); aiBtn.className = 'btn-secondary'; aiBtn.textContent = 'IA: liens + image';
    aiBtn.addEventListener('click', async () => {
      status.textContent = 'IA en cours...';
      try {
        const res = await adminFetch(`/admin/games/${g.id}/ai`, { method: 'POST' });
        const data = await res.json();
        status.textContent = 'OK';
        // Refresh UI fields if updated
        if (data?.game) {
          const ng = data.game;
          if (ng.links?.philibert != null) linkPhiI.value = ng.links.philibert || '';
          if (ng.image_url) imgI.value = ng.image_url;
          if (ng.price_philibert != null) pphiI.value = ng.price_philibert;
        }
      } catch (e) {
        console.error(e);
        status.textContent = 'Erreur IA';
      }
    });
    saveBtn.addEventListener('click', async () => {
      status.textContent = 'Enregistrement...';
      const payload = {
        name: nameI.value.trim(),
        possessed: !!possI.checked,
        wishlisted: !!wishI.checked,
        duration: durI.value.trim() || null,
        players_min: minI.value === '' ? null : parseInt(minI.value, 10),
        players_max: maxI.value === '' ? null : parseInt(maxI.value, 10),
        price_philibert: pphiI.value === '' ? null : parseFloat(pphiI.value),
        links: { philibert: linkPhiI.value.trim() || null },
        rules_pdf_url: pdfI.value.trim() || null,
        image_url: imgI.value.trim() || null,
      };
      try {
        await adminPatch(g.id, payload);
        status.textContent = 'OK';
        // refresh local data
        Object.assign(g, payload);
      } catch (e) {
        console.error(e);
        status.textContent = 'Erreur';
      }
    });
    const actions = document.createElement('div'); actions.className = 'row-actions'; actions.append(saveBtn, aiBtn, status);

    tr.append(
      idCell,
      td(nameI),
      td(possI),
      td(wishI),
      td(durI),
      td(minI),
      td(maxI),
      td(pphiI),
      td(linkPhiI),
      td(pdfI),
      td(imgI),
      td(actions)
    );
    return tr;
  }

  async function adminFetch(url, opts={}) {
    const secret = getSecret();
    if (!opts.headers) opts.headers = {};
    if (!secret) throw new Error('ADMIN_SECRET manquant');
    opts.headers['x-admin-secret'] = secret;
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  }

  async function adminPatch(id, payload) {
    return adminFetch(`/admin/games/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
  }

  async function runOp(kind) {
    try {
      el.opStatus.textContent = 'En cours...';
      const body = JSON.stringify({ limit: 200 });
      const url = kind === 'seed' ? '/admin/seed-wishlist' : (kind === 'og' ? '/admin/backfill-images' : '/admin/backfill-images-bgg');
      const res = await adminFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await res.json();
      el.opStatus.textContent = JSON.stringify(data);
      await load();
    } catch (e) {
      el.opStatus.textContent = 'Erreur: ' + e.message;
    }
  }

  // Events
  el.saveSecret.addEventListener('click', () => {
    setSecret(el.secret.value);
    el.secretStatus.textContent = 'Secret enregistré en session';
  });
  el.filter.addEventListener('change', () => { filter(); render(); });
  el.q.addEventListener('input', () => { filter(); render(); });
  el.refresh.addEventListener('click', load);
  el.seed.addEventListener('click', () => runOp('seed'));
  el.og.addEventListener('click', () => runOp('og'));
  el.bgg.addEventListener('click', () => runOp('bgg'));

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    const s = getSecret(); if (s) el.secret.value = s;
    load();
  });
})();
