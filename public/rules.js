// Dame – Regeln (läuft identisch im Browser und auf dem Server)
// 8x8-Brett, gespielt auf den dunklen Feldern.
// - Einfache Steine ziehen und schlagen nur vorwärts (diagonal)
// - Schlagpflicht, Mehrfachsprünge müssen zu Ende geschlagen werden
// - Dame ("König") zieht und schlägt beliebig weit (fliegende Dame)
// - Geschlagene Steine verschwinden erst am Ende des Zuges (dürfen nicht doppelt übersprungen werden)
// - Umwandlung zur Dame nur, wenn der Zug auf der gegnerischen Grundlinie endet
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DameRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const N = 8;
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const DRAW_LIMIT = 30; // 30 Halbzüge (15 je Seite) nur mit Damen, ohne Schlagen -> Remis

  const idx = (r, c) => r * N + c;
  const rc = (i) => [Math.floor(i / N), i % N];
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const colorOf = (p) => (p ? p.toLowerCase() : null);
  const isKing = (p) => p === 'W' || p === 'B';
  const forward = (color) => (color === 'w' ? -1 : 1); // Weiß spielt von unten nach oben
  const other = (color) => (color === 'w' ? 'b' : 'w');

  function initialBoard() {
    const b = Array(N * N).fill(null);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if ((r + c) % 2 === 1) {
          if (r < 3) b[idx(r, c)] = 'b';
          else if (r > 4) b[idx(r, c)] = 'w';
        }
    return b;
  }

  function captureSequences(board, from) {
    const piece = board[from];
    const color = colorOf(piece);
    const king = isKing(piece);
    const b = board.slice();
    b[from] = null; // Stein ist "in der Hand"
    const results = [];

    function dfs(pos, path, captured) {
      let extended = false;
      const [r, c] = rc(pos);
      for (const [dr, dc] of DIRS) {
        if (king) {
          let rr = r + dr, cc = c + dc;
          while (inB(rr, cc) && b[idx(rr, cc)] === null) { rr += dr; cc += dc; }
          if (!inB(rr, cc)) continue;
          const vi = idx(rr, cc);
          if (colorOf(b[vi]) === color || captured.includes(vi)) continue;
          let lr = rr + dr, lc = cc + dc;
          while (inB(lr, lc) && b[idx(lr, lc)] === null) {
            extended = true;
            dfs(idx(lr, lc), path.concat(idx(lr, lc)), captured.concat(vi));
            lr += dr; lc += dc;
          }
        } else {
          if (dr !== forward(color)) continue; // einfache Steine schlagen nur vorwärts
          const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
          if (!inB(lr, lc)) continue;
          const vi = idx(mr, mc);
          const v = b[vi];
          if (!v || colorOf(v) === color || captured.includes(vi)) continue;
          if (b[idx(lr, lc)] !== null) continue;
          extended = true;
          dfs(idx(lr, lc), path.concat(idx(lr, lc)), captured.concat(vi));
        }
      }
      if (!extended && captured.length) results.push({ path, captures: captured });
    }

    dfs(from, [from], []);
    return results;
  }

  function simpleMoves(board, from) {
    const piece = board[from];
    const color = colorOf(piece);
    const king = isKing(piece);
    const [r, c] = rc(from);
    const out = [];
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== forward(color)) continue;
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc) && board[idx(rr, cc)] === null) {
        out.push({ path: [from, idx(rr, cc)], captures: [] });
        if (!king) break;
        rr += dr; cc += dc;
      }
    }
    return out;
  }

  // Alle legalen Züge. Gibt es einen Schlag, sind nur Schläge erlaubt (Schlagpflicht).
  function legalMoves(board, color) {
    const caps = [];
    for (let i = 0; i < N * N; i++) if (colorOf(board[i]) === color) caps.push(...captureSequences(board, i));
    if (caps.length) return caps;
    const simple = [];
    for (let i = 0; i < N * N; i++) if (colorOf(board[i]) === color) simple.push(...simpleMoves(board, i));
    return simple;
  }

  function applyMove(board, move) {
    const b = board.slice();
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    let p = b[from];
    b[from] = null;
    for (const ci of move.captures) b[ci] = null;
    const [tr] = rc(to);
    if (p === 'w' && tr === 0) p = 'W';
    if (p === 'b' && tr === N - 1) p = 'B';
    b[to] = p;
    return b;
  }

  function samePath(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function findMove(board, color, path) {
    return legalMoves(board, color).find((m) => samePath(m.path, path)) || null;
  }

  function countPieces(board, color) {
    return board.filter((p) => colorOf(p) === color).length;
  }

  return {
    N, DRAW_LIMIT, idx, rc, colorOf, isKing, other,
    initialBoard, legalMoves, applyMove, findMove, samePath, countPieces,
  };
});
