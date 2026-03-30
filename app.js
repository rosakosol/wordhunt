/** @type {Set<string> | null} */
let wordSet = null;

const BOGGLE_DICE = [
  ["A", "A", "E", "E", "G", "N"],
  ["A", "B", "B", "J", "O", "O"],
  ["A", "C", "H", "O", "P", "S"],
  ["A", "F", "F", "K", "P", "S"],
  ["A", "O", "O", "T", "T", "W"],
  ["C", "I", "M", "O", "T", "U"],
  ["D", "E", "I", "L", "R", "X"],
  ["D", "E", "L", "R", "V", "Y"],
  ["D", "I", "S", "T", "T", "Y"],
  ["E", "E", "G", "H", "N", "W"],
  ["E", "E", "I", "N", "S", "U"],
  ["E", "H", "R", "T", "V", "W"],
  ["E", "I", "O", "S", "S", "S"],
  ["E", "L", "R", "T", "T", "Y"],
  ["H", "I", "M", "N", "U", "QU"],
  ["H", "L", "N", "N", "R", "Z"],
];

const MIN_WORD_LEN = 3;

/** Boggle-style points by word length */
function scoreForWord(len) {
  if (len < MIN_WORD_LEN) return 0;
  const table = { 3: 1, 4: 1, 5: 2, 6: 3, 7: 5 };
  return table[len] ?? 11;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 4x4 of { face: string for UI, piece: string for word (e.g. "qu") } */
function rollBoard() {
  const dice = shuffle(BOGGLE_DICE);
  const rows = [];
  let i = 0;
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 4; c++) {
      const die = dice[i++];
      const face = die[Math.floor(Math.random() * die.length)];
      const upper = face.toUpperCase();
      if (upper === "QU") {
        row.push({ face: "Qu", piece: "qu" });
      } else {
        row.push({ face: upper, piece: upper.toLowerCase() });
      }
    }
    rows.push(row);
  }
  return rows;
}

function neighbors(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4) out.push([nr, nc]);
    }
  }
  return out;
}

function pathToWord(board, path) {
  return path.map(([r, c]) => board[r][c].piece).join("");
}

const els = {
  setup: document.getElementById("setup"),
  game: document.getElementById("game"),
  loadStatus: document.getElementById("load-status"),
  durationSlider: document.getElementById("duration-slider"),
  durationInput: document.getElementById("duration-input"),
  btnStart: document.getElementById("btn-start"),
  board: document.getElementById("board"),
  timer: document.getElementById("timer"),
  score: document.getElementById("score"),
  currentWord: document.getElementById("current-word"),
  foundList: document.getElementById("found-list"),
  foundCount: document.getElementById("found-count"),
  btnEndEarly: document.getElementById("btn-end-early"),
  modalEnd: document.getElementById("modal-end"),
  finalScore: document.getElementById("final-score"),
  finalWords: document.getElementById("final-words"),
  finalWordList: document.getElementById("final-word-list"),
  btnPlayAgain: document.getElementById("btn-play-again"),
};

let board = [];
/** @type {Array<[number, number]>} */
let path = [];
let dragging = false;
let score = 0;
/** @type {Set<string>} */
let foundWords = new Set();
let timerId = null;
let secondsLeft = 0;

const MIN_ROUND_MIN = 1;
const MAX_ROUND_MIN = 5;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatMinutesAria(minutes) {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function syncDurationControls(fromSlider) {
  if (fromSlider) {
    const v = Number(els.durationSlider.value);
    els.durationInput.value = String(v);
  } else {
    let v = Number(els.durationInput.value);
    if (!Number.isFinite(v)) v = 2;
    v = Math.min(MAX_ROUND_MIN, Math.max(MIN_ROUND_MIN, Math.round(v)));
    els.durationInput.value = String(v);
    els.durationSlider.value = String(v);
  }
  const minutes = Number(els.durationInput.value);
  els.durationSlider.setAttribute("aria-valuetext", formatMinutesAria(minutes));
}

function renderBoard() {
  els.board.replaceChildren();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "tile";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      const { face, piece } = board[r][c];
      cell.textContent = face;
      cell.dataset.len = String(piece.length);
      cell.addEventListener("pointerdown", onTilePointerDown);
      cell.addEventListener("pointerenter", onTilePointerEnter);
      els.board.appendChild(cell);
    }
  }
}

function updatePathUI() {
  const tiles = els.board.querySelectorAll(".tile");
  tiles.forEach((t) => {
    t.classList.remove("in-path", "last");
  });
  path.forEach(([r, c], idx) => {
    const t = els.board.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (t) {
      t.classList.add("in-path");
      if (idx === path.length - 1) t.classList.add("last");
    }
  });
  const w = path.length ? pathToWord(board, path) : "";
  els.currentWord.textContent = w ? w.toUpperCase() : "—";
}

function tileFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest?.(".tile") ?? null;
}

function extendPathTo(r, c) {
  if (!path.length) return;

  const last = path[path.length - 1];
  if (last[0] === r && last[1] === c) return;

  if (path.length >= 2) {
    const prev = path[path.length - 2];
    if (prev[0] === r && prev[1] === c) {
      path.pop();
      updatePathUI();
      return;
    }
  }

  const inPath = path.some((p) => p[0] === r && p[1] === c);
  if (inPath) return;

  const adj = neighbors(last[0], last[1]).some((x) => x[0] === r && x[1] === c);
  if (!adj) return;

  path.push([r, c]);
  updatePathUI();
}

function onTilePointerDown(e) {
  if (!timerId) return;
  e.preventDefault();
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  dragging = true;
  path = [[r, c]];
  updatePathUI();
}

function onTilePointerEnter(e) {
  if (!dragging || !timerId) return;
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  extendPathTo(r, c);
}

function onWindowPointerMove(e) {
  if (!dragging || !timerId) return;
  const tile = tileFromPoint(e.clientX, e.clientY);
  if (!tile) return;
  const r = Number(tile.dataset.r);
  const c = Number(tile.dataset.c);
  extendPathTo(r, c);
}

function submitPath() {
  if (!path.length || !wordSet) return;
  const word = pathToWord(board, path);
  path = [];
  updatePathUI();

  if (word.length < MIN_WORD_LEN) return;
  if (!wordSet.has(word)) return;
  if (foundWords.has(word)) return;

  foundWords.add(word);
  const pts = scoreForWord(word.length);
  score += pts;
  els.score.textContent = String(score);

  const li = document.createElement("li");
  li.textContent = `${word} +${pts}`;
  li.classList.add("new");
  els.foundList.prepend(li);
  els.foundCount.textContent = String(foundWords.size);
}

function onGlobalPointerUp() {
  if (dragging) {
    dragging = false;
    submitPath();
  }
}

function tickTimer() {
  secondsLeft -= 1;
  els.timer.textContent = formatTime(secondsLeft);
  els.timer.classList.remove("low", "critical");
  if (secondsLeft <= 10) els.timer.classList.add("critical");
  else if (secondsLeft <= 30) els.timer.classList.add("low");

  if (secondsLeft <= 0) {
    endRound();
  }
}

function startRound() {
  let minutes = Number(els.durationInput.value);
  if (!Number.isFinite(minutes)) minutes = 2;
  minutes = Math.min(MAX_ROUND_MIN, Math.max(MIN_ROUND_MIN, Math.round(minutes)));
  secondsLeft = minutes * 60;
  score = 0;
  foundWords = new Set();
  board = rollBoard();
  path = [];
  dragging = false;

  els.score.textContent = "0";
  els.foundList.replaceChildren();
  els.foundCount.textContent = "0";
  els.timer.textContent = formatTime(secondsLeft);
  els.timer.classList.remove("low", "critical");
  els.currentWord.textContent = "—";

  renderBoard();
  updatePathUI();

  els.setup.hidden = true;
  els.game.hidden = false;
  els.modalEnd.hidden = true;

  if (timerId) clearInterval(timerId);
  timerId = setInterval(tickTimer, 1000);
}

function endRound() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  dragging = false;
  path = [];
  updatePathUI();

  const sorted = [...foundWords].sort();
  els.finalScore.textContent = String(score);
  els.finalWords.textContent = String(foundWords.size);
  els.finalWordList.replaceChildren();
  sorted.forEach((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    els.finalWordList.appendChild(li);
  });
  els.modalEnd.hidden = false;
}

async function loadDictionary() {
  els.loadStatus.hidden = false;
  els.loadStatus.textContent = "Loading dictionary…";
  els.btnStart.disabled = true;
  try {
    const res = await fetch("./words.json");
    if (!res.ok) throw new Error("Failed to load words");
    const arr = await res.json();
    wordSet = new Set(arr);
    els.loadStatus.hidden = true;
  } catch {
    wordSet = null;
    els.loadStatus.hidden = false;
    els.loadStatus.textContent =
      "Could not load dictionary. Run a local server (e.g. npx serve) so words.json can load.";
  } finally {
    els.btnStart.disabled = false;
  }
}

els.durationSlider.addEventListener("input", () => syncDurationControls(true));
els.durationInput.addEventListener("change", () => syncDurationControls(false));

els.btnStart.addEventListener("click", () => {
  if (!wordSet || wordSet.size === 0) {
    els.loadStatus.hidden = false;
    els.loadStatus.textContent = "Dictionary not ready. Check words.json and use a local server.";
    return;
  }
  startRound();
});

els.btnEndEarly.addEventListener("click", endRound);
els.btnPlayAgain.addEventListener("click", () => {
  els.modalEnd.hidden = true;
  els.setup.hidden = false;
  els.game.hidden = true;
});

window.addEventListener("pointermove", onWindowPointerMove);
window.addEventListener("pointerup", onGlobalPointerUp);
window.addEventListener("pointercancel", onGlobalPointerUp);

syncDurationControls(true);
loadDictionary();
