// Dame – Browser-Logik
(() => {
  const R = window.DameRules;
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');

  let clientId = store.get('dame.clientId');
  if (!clientId) { clientId = rand(20); store.set('dame.clientId', clientId); }
  let name = store.get('dame.name') || '';
  // Spiel-Code robust aus der Adresse lesen: Messenger hängen gern Text, Satzzeichen
  // oder Leerzeichen direkt an den Link. Codes sind immer 8 Zeichen lang -> die ersten
  // 8 Buchstaben/Ziffern nach "r=" zählen, der Rest wird ignoriert.
  function readRoomId() {
    let raw = location.search + location.hash;
    try { raw = decodeURIComponent(raw); } catch {}
    const m = raw.toLowerCase().match(/[?&#]r=([a-z0-9]{4,})/);
    return m ? m[1].slice(0, 8) : '';
  }
  let roomId = readRoomId();
  const brokenInvite = !roomId && /[?&#]r=/i.test(location.search + location.hash);
  if (brokenInvite) history.replaceState(null, '', location.pathname);
  if (roomId && location.search !== '?r=' + roomId) history.replaceState(null, '', '?r=' + roomId);

  let ws = null, state = null, prevBoard = null, animatedSeq = null, flipped = null;
  let selection = []; // angeklickter Pfad (Feldindizes)
  let retry = 0;

  // ---------- Lobby ----------
  const nameInput = $('#nameInput');
  nameInput.value = name;
  function showLobby() {
    $('#lobby').classList.remove('hidden');
    $('#game').classList.add('hidden');
    if (brokenInvite) {
      $('#lobbyText').textContent = 'Dieser Einladungslink ist unvollständig. Bitte lass ihn dir noch einmal schicken – oder starte hier eine eigene Partie.';
    } else if (roomId) {
      $('#lobbyText').textContent = 'Du wurdest zu einer Partie Dame eingeladen. Wie heißt du?';
      $('#startBtn').textContent = 'Mitspielen';
    }
    setTimeout(() => nameInput.focus(), 50);
  }
  function start() {
    name = nameInput.value.trim().slice(0, 20);
    if (!name) { nameInput.focus(); return toast('Bitte gib einen Namen ein'); }
    store.set('dame.name', name);
    if (!roomId) {
      roomId = rand(8);
      history.replaceState(null, '', '?r=' + roomId);
    }
    $('#lobby').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#shareBtn').classList.remove('hidden');
    connect();
  }
  $('#startBtn').addEventListener('click', start);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

  // ---------- Verbindung ----------
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => {
      retry = 0;
      $('#conn').classList.add('hidden');
      ws.send(JSON.stringify({ type: 'join', room: roomId, clientId, name }));
      ws.send(JSON.stringify({ type: 'history', clientId }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') onState(msg);
      else if (msg.type === 'history') renderHistory(msg.games);
      else if (msg.type === 'full') { ws.onclose = null; ws.close(); setStatus('Diese Partie ist schon voll. Starte eine neue über die Startseite.'); }
      else if (msg.type === 'error' && /Link/.test(msg.msg)) {
        // Kaputter Link: nicht endlos weiterversuchen, sondern klar erklären
        ws.onclose = null; ws.close();
        setStatus(`Dieser Einladungslink ist unvollständig (Code: „${esc(roomId)}“). Bitte lass dir den Link noch einmal schicken – oder <a href="/">starte eine neue Partie</a>.`);
      }
      else if (msg.type === 'error') toast(msg.msg);
    };
    ws.onclose = () => {
      $('#conn').classList.remove('hidden');
      setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
    };
  }
  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

  // ---------- Brett aufbauen ----------
  const squaresEl = $('#squares'), piecesEl = $('#pieces');
  const disp = (i) => { const [r, c] = R.rc(i); return flipped ? [7 - r, 7 - c] : [r, c]; };

  function buildBoard() {
    squaresEl.innerHTML = '';
    for (let dr = 0; dr < 8; dr++)
      for (let dc = 0; dc < 8; dc++) {
        const r = flipped ? 7 - dr : dr, c = flipped ? 7 - dc : dc;
        const i = R.idx(r, c);
        const el = document.createElement('div');
        el.className = 'sq ' + ((r + c) % 2 ? 'dark' : 'light');
        el.dataset.i = i;
        // Jedes Feld zeigt einen anderen Ausschnitt der Maserung -> wirkt wie echte Holzstücke
        el.style.backgroundPosition = `${(i * 37) % 260}px ${(i * 91) % 260}px, 0 0`;
        squaresEl.appendChild(el);
      }
    const files = 'abcdefgh'.split(''), ranks = '87654321'.split('');
    const f = flipped ? files.slice().reverse() : files, rk = flipped ? ranks.slice().reverse() : ranks;
    const fill = (el, arr) => { el.innerHTML = arr.map((x) => `<span>${x}</span>`).join(''); };
    fill($('#filesBottom'), f); fill($('#ranksLeft'), rk);
  }
  squaresEl.addEventListener('click', (e) => {
    const sq = e.target.closest('.sq');
    if (sq) onSquare(Number(sq.dataset.i));
  });

  function discHTML(p) {
    const c = R.colorOf(p), k = R.isKing(p);
    return `<div class="disc ${c}${k ? ' k' : ''}">${k ? '<svg viewBox="0 0 24 24"><use href="#crown"/></svg>' : ''}</div>`;
  }
  function placePiece(p, i, cls = '') {
    const el = document.createElement('div');
    const [r, c] = disp(i);
    el.className = 'piece ' + cls;
    el.style.left = c * 12.5 + '%';
    el.style.top = r * 12.5 + '%';
    el.innerHTML = discHTML(p);
    el.dataset.i = i;
    piecesEl.appendChild(el);
    return el;
  }

  // ---------- Zustand ----------
  function onState(s) {
    const newFlip = s.you === 'b';
    const newGame = !state || state.gameNo !== s.gameNo;
    if (flipped !== newFlip) { flipped = newFlip; buildBoard(); }
    if (newGame) { selection = []; prevBoard = null; animatedSeq = s.lastMove ? s.lastMove.seq : null; }
    if (state && state.status !== 'over' && s.status === 'over') send({ type: 'history', clientId });
    state = s;
    render();
  }

  function myLegal() {
    if (!state || state.status !== 'playing' || state.turn !== state.you) return [];
    return R.legalMoves(state.board, state.you);
  }

  function render() {
    const s = state;
    const legal = myLegal();
    const animate = s.lastMove && s.lastMove.seq !== animatedSeq && prevBoard;

    // Felder: letzter Zug, Auswahl, Ziele
    const candidates = selection.length ? legal.filter((m) => selection.every((v, k) => m.path[k] === v)) : [];
    const next = new Set(candidates.filter((m) => m.path.length > selection.length).map((m) => m.path[selection.length]));
    const lastSet = new Set(s.lastMove ? s.lastMove.path : []);
    for (const el of squaresEl.children) {
      const i = Number(el.dataset.i);
      el.classList.toggle('last', lastSet.has(i));
      el.classList.toggle('from', selection.includes(i));
      el.classList.toggle('target', next.has(i));
    }

    // Steine
    piecesEl.innerHTML = '';
    const movable = new Set(legal.map((m) => m.path[0]));
    s.board.forEach((p, i) => {
      if (!p) return;
      const cls = [];
      if (!selection.length && movable.has(i)) cls.push('selectable');
      if (selection.length && selection[selection.length - 1] === i) cls.push('selected');
      placePiece(p, i, cls.join(' '));
    });
    // Ausgewählter Stein steht während eines Mehrfachsprungs "in der Luft" auf dem Zwischenfeld
    if (selection.length > 1) {
      const origin = piecesEl.querySelector(`.piece[data-i="${selection[0]}"]`);
      if (origin) {
        const [r, c] = disp(selection[selection.length - 1]);
        origin.style.left = c * 12.5 + '%'; origin.style.top = r * 12.5 + '%';
        origin.classList.add('selected', 'moving');
      }
    }
    if (animate) animateLastMove();
    prevBoard = s.board;

    renderPlayers(legal);
    renderStatus(legal);
  }

  function animateLastMove() {
    const m = state.lastMove;
    animatedSeq = m.seq;
    const to = m.path[m.path.length - 1];
    const el = piecesEl.querySelector(`.piece[data-i="${to}"]`);
    const hop = m.path.length > 2 ? 260 : 300;
    if (el) {
      const [tr, tc] = disp(to);
      const frames = m.path.map((i) => {
        const [r, c] = disp(i);
        return { transform: `translate(${(c - tc) * 100}%, ${(r - tr) * 100}%)` };
      });
      el.classList.add('moving');
      const a = el.animate(frames, { duration: hop * (m.path.length - 1), easing: 'cubic-bezier(.45,.05,.3,1)' });
      a.onfinish = () => el.classList.remove('moving');
    }
    m.captures.forEach((ci, k) => {
      if (!prevBoard[ci]) return;
      const g = placePiece(prevBoard[ci], ci, 'ghost');
      const a = g.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.6)' }],
        { duration: 280, delay: hop * (k + 0.6), fill: 'forwards', easing: 'ease-in' });
      a.onfinish = () => g.remove();
    });
  }

  // ---------- Klick-Logik ----------
  function onSquare(i) {
    const legal = myLegal();
    if (!legal.length) return;
    const own = R.colorOf(state.board[i]) === state.you;

    // Neuen Stein wählen
    if (own && (selection.length <= 1 || i !== selection[0])) {
      if (legal.some((m) => m.path[0] === i)) selection = selection[0] === i && selection.length === 1 ? [] : [i];
      else { selection = []; toast(legal[0].captures.length ? 'Schlagpflicht! Ein anderer Stein muss schlagen.' : 'Dieser Stein kann nicht ziehen.'); }
      return render();
    }
    if (!selection.length) return;

    const prefix = legal.filter((m) => selection.every((v, k) => m.path[k] === v));
    // 1) Nächster Schritt im Pfad
    const step = prefix.filter((m) => m.path[selection.length] === i);
    if (step.length) {
      const path = selection.concat(i);
      const complete = step.filter((m) => m.path.length === path.length);
      if (complete.length && step.length === complete.length) return commit(complete[0]);
      selection = path;
      return render();
    }
    // 2) Abkürzung: direkt aufs Endfeld tippen
    const direct = prefix.filter((m) => m.path[m.path.length - 1] === i);
    if (direct.length === 1) return commit(direct[0]);
    if (direct.length > 1) { toast('Mehrere Wege möglich – tippe die Sprungfelder nacheinander an.'); return; }
    selection = [];
    render();
  }

  function commit(move) {
    selection = [];
    send({ type: 'move', path: move.path });
  }

  $('#rematchBtn').addEventListener('click', () => send({ type: 'rematch' }));
  $('#resignBtn').addEventListener('click', () => {
    if (confirm('Partie wirklich aufgeben?')) send({ type: 'resign' });
  });
  $('#shareBtn').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?r=' + roomId;
    try {
      // Nur Titel + Link teilen: Manche Apps kleben einen zusätzlichen Text direkt an den Link
      if (navigator.share) await navigator.share({ title: `${name} fordert dich zu einer Partie Dame heraus!`, url });
      else { await navigator.clipboard.writeText(url); toast('Link kopiert'); }
    } catch {}
  });

  // ---------- Anzeige ----------
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderPlayers() {
    const s = state;
    const me = s.players.find((p) => p.color === s.you);
    const opp = s.players.find((p) => p.color !== s.you);
    const chip = (p, color, isMe) => {
      const el = isMe ? $('#pBottom') : $('#pTop');
      const captured = 12 - R.countPieces(s.board, R.other(color));
      const active = s.status === 'playing' && s.turn === color;
      el.classList.toggle('active', active);
      if (!p) { el.innerHTML = `<div class="disc ${color}"></div><span class="tag">Warte auf Mitspieler …</span>`; return; }
      el.innerHTML = `<div class="disc ${color}"></div>
        <span class="name">${esc(p.name)}</span>
        <span class="tag">${isMe ? 'Du' : ''}${p.connected ? '' : ' <span class="off">offline</span>'}</span>
        <span class="meta">
          ${active ? '<span class="turn-dot" title="am Zug"></span>' : ''}
          <span title="geschlagene Steine">⨯ ${captured}</span>
          <span class="wins" title="Siege in diesem Raum">Siege <b>${p.wins}</b></span>
        </span>`;
    };
    const myColor = s.you || 'w';
    chip(me, myColor, true);
    chip(opp, R.other(myColor), false);
  }

  function setStatus(html) { $('#status').innerHTML = html; }

  function renderStatus(legal) {
    const s = state;
    const opp = s.players.find((p) => p.color !== s.you);
    const oppName = opp ? esc(opp.name) : 'Mitspieler';
    $('#rematchBtn').classList.toggle('hidden', s.status !== 'over');
    $('#resignBtn').classList.toggle('hidden', s.status !== 'playing');

    if (s.status === 'waiting') return setStatus('Warte auf Mitspieler – tippe oben auf <b>Einladen</b> und schick den Link.');
    if (s.status === 'playing') {
      if (s.turn === s.you) {
        const must = legal.length && legal[0].captures.length;
        const draw = s.quiet >= s.drawLimit - 6 ? ` · Remis in ${s.drawLimit - s.quiet} Halbzügen` : '';
        return setStatus(`<b>Du bist am Zug</b>${must ? ' · <span class="must">Schlagpflicht</span>' : ''}${draw}`);
      }
      return setStatus(`${oppName} ist am Zug …`);
    }
    // vorbei
    const mine = s.rematch.includes(s.you), theirs = s.rematch.some((c) => c !== s.you);
    let txt = s.winner === 'draw' ? '<b>Remis</b>' : s.winner === s.you ? '<b>Du hast gewonnen!</b> 🎉' : `<b>${oppName} hat gewonnen</b>`;
    txt += `<br><small>${esc(s.reason || '')}</small>`;
    if (mine && !theirs) txt += `<br><small>Warte, bis ${oppName} die Revanche annimmt …</small>`;
    if (theirs && !mine) txt += `<br><small>${oppName} möchte eine Revanche!</small>`;
    $('#rematchBtn').textContent = theirs && !mine ? 'Revanche annehmen' : 'Revanche';
    $('#rematchBtn').disabled = mine;
    setStatus(txt);
  }

  function renderHistory(games) {
    const list = $('#historyList');
    if (!games.length) { list.innerHTML = '<li class="empty">Noch keine beendeten Partien.</li>'; return; }
    list.innerHTML = games.map((g) => {
      const opp = g.mine === 'w' ? g.black : g.white;
      const res = g.winner === 'draw' ? ['draw', 'Remis'] : g.winner === g.mine ? ['win', 'Sieg'] : ['loss', 'Niederlage'];
      const d = new Date(g.date);
      return `<li><span class="res ${res[0]}">${res[1]}</span><span>gegen ${esc(opp)}</span>
        <span class="sub">${d.toLocaleDateString('de-DE')} · ${g.moves} Züge<br>${esc(g.reason || '')}</span></li>`;
    }).join('');
  }

  let toastTimer;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Start ----------
  if (roomId && name) {
    $('#game').classList.remove('hidden');
    $('#shareBtn').classList.remove('hidden');
    connect();
  } else showLobby();
})();
