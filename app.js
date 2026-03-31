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
  ["H", "I", "M", "N", "U", "Q"],
  ["H", "L", "N", "N", "R", "Z"],
];

const SVG_NS = "http://www.w3.org/2000/svg";

const MIN_WORD_LEN = 3;

const API_MP = "/api/mp";
const API_AUTH = "/api/auth";

const LS_AUTH_TOKEN = "wh_auth_token";
const LS_AUTH_USER = "wh_auth_user";

const MIN_ROUND_MIN = 1;
const MAX_ROUND_MIN = 5;

/** @type {{ active: boolean, role: string | null, roomId: string | null, secret: string | null, endsAt: number | null }} */
const mp = {
  active: false,
  role: null,
  roomId: null,
  secret: null,
  endsAt: null,
};

let mpPollTimer = null;
let mpResultPollTimer = null;
let hostLobbyPollTimer = null;

/** @type {string | null} */
let authToken = null;
let authUsername = "";
let authTotal = 0;
/** @type {number | null} */
let authRank = null;

/** Points by word length: 3→100, 4→400, 5→800; same curve continues (50n² − 50n − 200). */
function scoreForWord(len) {
  if (len < MIN_WORD_LEN) return 0;
  return 50 * len * len - 50 * len - 200;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 4x4 of { face, piece }: one letter each (display + word fragment). */
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
      row.push({ face: upper, piece: upper.toLowerCase() });
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
  boardPath: document.getElementById("board-path"),
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
  modalMpWait: document.getElementById("modal-mp-wait"),
  modalMpResult: document.getElementById("modal-mp-result"),
  mpResultTitle: document.getElementById("mp-result-title"),
  mpResultBody: document.getElementById("mp-result-body"),
  mpResultScores: document.getElementById("mp-result-scores"),
  btnMpDone: document.getElementById("btn-mp-done"),
  tabSolo: document.getElementById("tab-solo"),
  tabMulti: document.getElementById("tab-multi"),
  soloPanel: document.getElementById("solo-panel"),
  multiPanel: document.getElementById("multi-panel"),
  btnCreateMp: document.getElementById("btn-create-mp"),
  mpHostLobby: document.getElementById("mp-host-lobby"),
  mpHostOpponentStatus: document.getElementById("mp-host-opponent-status"),
  mpGuestWait: document.getElementById("mp-guest-wait"),
  mpGuestUrl: document.getElementById("mp-guest-url"),
  btnCopyGuest: document.getElementById("btn-copy-guest"),
  btnMpBegin: document.getElementById("btn-mp-begin"),
  mpGuestMsg: document.getElementById("mp-guest-msg"),
  mpRolePill: document.getElementById("mp-role-pill"),
  authSummary: document.getElementById("auth-summary"),
  btnOpenRegister: document.getElementById("btn-open-register"),
  btnOpenLogin: document.getElementById("btn-open-login"),
  btnOpenLb: document.getElementById("btn-open-lb"),
  loginSignedIn: document.getElementById("login-signed-in"),
  loginSignedInMsg: document.getElementById("login-signed-in-msg"),
  loginFormWrap: document.getElementById("login-form"),
  btnLoginLogout: document.getElementById("btn-login-logout"),
  modalRegister: document.getElementById("modal-register"),
  modalLogin: document.getElementById("modal-login"),
  modalLeaderboard: document.getElementById("modal-leaderboard"),
  regUsername: document.getElementById("reg-username"),
  regPassword: document.getElementById("reg-password"),
  regMsg: document.getElementById("reg-msg"),
  btnRegisterSubmit: document.getElementById("btn-register-submit"),
  btnRegisterCancel: document.getElementById("btn-register-cancel"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  loginMsg: document.getElementById("login-msg"),
  btnLoginSubmit: document.getElementById("btn-login-submit"),
  btnLoginCancel: document.getElementById("btn-login-cancel"),
  lbTbody: document.getElementById("lb-tbody"),
  lbYou: document.getElementById("lb-you"),
  lbMsg: document.getElementById("lb-msg"),
  btnLbClose: document.getElementById("btn-lb-close"),
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
/** @type {ResizeObserver | null} */
let pathResizeObserver = null;

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

function clearMpPollers() {
  if (mpPollTimer) {
    clearInterval(mpPollTimer);
    mpPollTimer = null;
  }
  if (mpResultPollTimer) {
    clearInterval(mpResultPollTimer);
    mpResultPollTimer = null;
  }
  if (hostLobbyPollTimer) {
    clearInterval(hostLobbyPollTimer);
    hostLobbyPollTimer = null;
  }
}

function setHostOpponentJoinedUI(joined) {
  const el = els.mpHostOpponentStatus;
  if (!el) return;
  el.classList.toggle("mp-opponent-waiting", !joined);
  el.classList.toggle("mp-opponent-joined", joined);
  el.textContent = joined
    ? "Opponent has joined — start the match when you’re both ready."
    : "Waiting for opponent to open the guest link…";
}

function resetHostOpponentStatusUI() {
  setHostOpponentJoinedUI(false);
}

function startHostLobbyPolling() {
  if (hostLobbyPollTimer) {
    clearInterval(hostLobbyPollTimer);
    hostLobbyPollTimer = null;
  }
  if (!mp.roomId || !mp.secret || mp.role !== "host") return;
  hostLobbyPollTimer = setInterval(async () => {
    try {
      const st = await mpFetchState(mp.roomId, "host", mp.secret);
      if (st.guestJoined) {
        setHostOpponentJoinedUI(true);
        clearInterval(hostLobbyPollTimer);
        hostLobbyPollTimer = null;
      }
    } catch {
      /* ignore */
    }
  }, 1200);
}

function mpSessionKey(roomId) {
  return `wh_mp_room_${roomId}`;
}

function saveMpSession(roomId, data) {
  try {
    sessionStorage.setItem(mpSessionKey(roomId), JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function loadMpSession(roomId) {
  try {
    const raw = sessionStorage.getItem(mpSessionKey(roomId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function mpFetchState(roomId, role, secret) {
  const u = new URL(API_MP, window.location.origin);
  u.searchParams.set("action", "state");
  u.searchParams.set("roomId", roomId);
  u.searchParams.set("p", role);
  u.searchParams.set("s", secret);
  const res = await fetch(u.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

async function mpPost(action, body) {
  const u = new URL(API_MP, window.location.origin);
  u.searchParams.set("action", action);
  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

function loadStoredAuth() {
  try {
    authToken = localStorage.getItem(LS_AUTH_TOKEN);
    authUsername = localStorage.getItem(LS_AUTH_USER) || "";
  } catch {
    authToken = null;
    authUsername = "";
  }
  if (!authToken) {
    authToken = null;
    authUsername = "";
  }
}

function applyAuthResponse(data) {
  if (!data?.token) return;
  authToken = data.token;
  authUsername = String(data.username || "");
  authTotal = Number(data.totalPoints) || 0;
  authRank = data.rank != null ? Number(data.rank) : null;
  try {
    localStorage.setItem(LS_AUTH_TOKEN, authToken);
    localStorage.setItem(LS_AUTH_USER, authUsername);
  } catch {
    /* ignore */
  }
  updateAuthBar();
}

function clearAuth() {
  authToken = null;
  authUsername = "";
  authTotal = 0;
  authRank = null;
  try {
    localStorage.removeItem(LS_AUTH_TOKEN);
    localStorage.removeItem(LS_AUTH_USER);
  } catch {
    /* ignore */
  }
  updateAuthBar();
}

function updateAuthBar() {
  if (!els.authSummary) return;
  if (!authToken) {
    els.authSummary.textContent = "";
  } else {
    const pts = Number(authTotal) || 0;
    const r = authRank != null && Number.isFinite(authRank) ? ` · #${authRank} on board` : "";
    els.authSummary.textContent = `${authUsername} — ${pts} pts${r}`;
  }
}

function syncLoginModalLayout() {
  const signedIn = !!authToken;
  if (els.loginSignedIn) els.loginSignedIn.hidden = !signedIn;
  if (els.loginFormWrap) els.loginFormWrap.hidden = signedIn;
  if (els.btnLoginSubmit) els.btnLoginSubmit.hidden = signedIn;
  if (signedIn && els.loginSignedInMsg) {
    const pts = Number(authTotal) || 0;
    els.loginSignedInMsg.textContent = `You’re signed in as ${authUsername} (${pts} total pts). Log out to switch accounts.`;
  }
}

async function authPost(action, payload, bearer) {
  const u = new URL(API_AUTH, window.location.origin);
  const headers = { "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(u.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data, status: res.status };
}

async function refreshAuthMe() {
  if (!authToken) return;
  const u = new URL(API_AUTH, window.location.origin);
  u.searchParams.set("action", "me");
  try {
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${authToken}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      clearAuth();
      return;
    }
    authUsername = String(data.username || authUsername);
    authTotal = Number(data.totalPoints) || 0;
    authRank = data.rank != null ? Number(data.rank) : null;
    try {
      localStorage.setItem(LS_AUTH_USER, authUsername);
    } catch {
      /* ignore */
    }
    updateAuthBar();
  } catch {
    /* keep token; offline */
  }
}

async function submitLeaderboardDelta(delta) {
  if (!authToken) return;
  const pts = Math.round(Number(delta));
  if (!Number.isFinite(pts) || pts <= 0) return;
  const safe = Math.min(pts, 1e9);
  try {
    const { ok, data } = await authPost("addScore", { points: safe }, authToken);
    if (ok && typeof data.totalPoints === "number") {
      authTotal = data.totalPoints;
      authRank = data.rank != null ? Number(data.rank) : authRank;
      updateAuthBar();
    }
  } catch {
    /* ignore */
  }
}

/** Submit this device user’s multiplayer round score (call only when the match just finished live). */
function submitMpLeaderboardFromState(st) {
  const my = mp.role === "host" ? (st.hostScore ?? 0) : (st.guestScore ?? 0);
  void submitLeaderboardDelta(my);
}

async function openLeaderboardModal() {
  if (!els.modalLeaderboard || !els.lbTbody) return;
  els.modalLeaderboard.hidden = false;
  els.lbTbody.replaceChildren();
  els.lbMsg.textContent = "Loading…";
  els.lbMsg.classList.remove("lb-err");
  if (els.lbYou) {
    els.lbYou.textContent = authToken
      ? "Your total includes every solo and multiplayer round you finish while logged in on this device."
      : "Sign in to track your total score across rounds.";
  }

  const lbUrl = new URL(API_AUTH, window.location.origin);
  lbUrl.searchParams.set("action", "leaderboard");
  const meUrl = new URL(API_AUTH, window.location.origin);
  meUrl.searchParams.set("action", "me");

  try {
    const lbPromise = fetch(lbUrl.toString());
    const mePromise = authToken
      ? fetch(meUrl.toString(), { headers: { Authorization: `Bearer ${authToken}` } })
      : Promise.resolve(null);
    const [lbRes, meRes] = await Promise.all([lbPromise, mePromise]);

    const lbData = await lbRes.json().catch(() => ({}));
    if (!lbRes.ok) {
      els.lbMsg.textContent = lbData.message || lbData.error || "Could not load leaderboard.";
      els.lbMsg.classList.add("lb-err");
      return;
    }

    /** @type {{ rank: number, username: string, points: number }[]} */
    const entries = Array.isArray(lbData.entries) ? lbData.entries : [];
    const meName = authUsername ? authUsername.toLowerCase() : "";
    let meRow = null;
    if (meRes && meRes.ok) {
      const me = await meRes.json().catch(() => ({}));
      if (typeof me.totalPoints === "number") {
        authTotal = me.totalPoints;
        authRank = me.rank != null ? Number(me.rank) : authRank;
        updateAuthBar();
      }
      if (els.lbYou && me.username) {
        const rp = me.rank != null ? `#${me.rank}` : "—";
        els.lbYou.textContent = `You are ${rp} with ${me.totalPoints ?? 0} total pts (all rounds on this account).`;
      }
    }

    entries.forEach((row) => {
      const tr = document.createElement("tr");
      const u = String(row.username || "");
      if (meName && u.toLowerCase() === meName) {
        tr.classList.add("lb-you");
        meRow = tr;
      }
      const tdR = document.createElement("td");
      tdR.textContent = String(row.rank ?? "");
      const tdU = document.createElement("td");
      tdU.textContent = u;
      const tdP = document.createElement("td");
      tdP.textContent = String(row.points ?? 0);
      tr.append(tdR, tdU, tdP);
      els.lbTbody.appendChild(tr);
    });

    if (entries.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "No scores yet. Play a round while logged in!";
      tr.appendChild(td);
      els.lbTbody.appendChild(tr);
    }

    els.lbMsg.textContent = "";
    if (authToken && meName && !meRow && entries.length > 0) {
      els.lbMsg.textContent =
        "You’re not in the top 100 yet — your rank and total are shown above.";
    }
  } catch {
    els.lbMsg.textContent = "Network error loading leaderboard.";
    els.lbMsg.classList.add("lb-err");
  }
}

function parseMpUrl() {
  const q = new URLSearchParams(window.location.search);
  const roomId = q.get("mp");
  const role = q.get("p");
  const secret = q.get("s");
  if (!roomId || !secret || (role !== "host" && role !== "guest")) return null;
  return { roomId, role, secret };
}

function setHostUrl(roomId, hostSecret) {
  const u = new URL(window.location.href);
  u.searchParams.set("mp", roomId);
  u.searchParams.set("p", "host");
  u.searchParams.set("s", hostSecret);
  history.replaceState(null, "", u.toString());
}

function setModeTab(solo) {
  els.tabSolo.classList.toggle("active", solo);
  els.tabMulti.classList.toggle("active", !solo);
  els.tabSolo.setAttribute("aria-selected", solo ? "true" : "false");
  els.tabMulti.setAttribute("aria-selected", solo ? "false" : "true");
  els.soloPanel.hidden = !solo;
  els.multiPanel.hidden = solo;
}

function stopGameTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function tickTimerSolo() {
  secondsLeft -= 1;
  els.timer.textContent = formatTime(secondsLeft);
  els.timer.classList.remove("low", "critical");
  if (secondsLeft <= 10) els.timer.classList.add("critical");
  else if (secondsLeft <= 30) els.timer.classList.add("low");
  if (secondsLeft <= 0) {
    stopGameTimer();
    endRound();
  }
}

function tickTimerMulti() {
  if (mp.endsAt == null) return;
  secondsLeft = Math.max(0, Math.ceil((mp.endsAt - Date.now()) / 1000));
  els.timer.textContent = formatTime(secondsLeft);
  els.timer.classList.remove("low", "critical");
  if (secondsLeft <= 10) els.timer.classList.add("critical");
  else if (secondsLeft <= 30) els.timer.classList.add("low");
  if (secondsLeft <= 0) {
    stopGameTimer();
    endRound();
  }
}

function startGameTimer() {
  stopGameTimer();
  if (mp.active && mp.endsAt != null) {
    tickTimerMulti();
    timerId = setInterval(tickTimerMulti, 500);
  } else {
    timerId = setInterval(tickTimerSolo, 1000);
  }
}

function ensurePathResizeObserver() {
  const stack = els.board.parentElement;
  if (!stack?.classList.contains("board-stack") || pathResizeObserver) return;
  pathResizeObserver = new ResizeObserver(() => {
    if (path.length) requestAnimationFrame(() => updatePathLine());
  });
  pathResizeObserver.observe(stack);
}

function updatePathLine() {
  const svg = els.boardPath;
  const boardEl = els.board;
  if (!svg || !boardEl) return;

  svg.replaceChildren();

  if (path.length === 0) return;

  const br = boardEl.getBoundingClientRect();
  const bw = br.width;
  const bh = br.height;
  if (bw < 1 || bh < 1) return;

  svg.setAttribute("viewBox", `0 0 ${bw} ${bh}`);
  svg.setAttribute("preserveAspectRatio", "none");

  /** @type {{ x: number, y: number }[]} */
  const centers = [];
  for (const [r, c] of path) {
    const tile = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (!tile) continue;
    const tr = tile.getBoundingClientRect();
    centers.push({
      x: tr.left + tr.width / 2 - br.left,
      y: tr.top + tr.height / 2 - br.top,
    });
  }

  if (centers.length === 0) return;

  const pointsStr = centers.map((p) => `${p.x},${p.y}`).join(" ");

  if (centers.length >= 2) {
    const halo = document.createElementNS(SVG_NS, "polyline");
    halo.setAttribute("class", "path-halo");
    halo.setAttribute("points", pointsStr);
    halo.setAttribute("fill", "none");
    halo.setAttribute("stroke-width", "12");
    halo.setAttribute("stroke-linecap", "round");
    halo.setAttribute("stroke-linejoin", "round");
    svg.appendChild(halo);

    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("class", "path-line");
    line.setAttribute("points", pointsStr);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke-width", "4");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);
  }

  centers.forEach((p, i) => {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(p.x));
    circle.setAttribute("cy", String(p.y));
    const isEnd = i === centers.length - 1;
    circle.setAttribute("r", isEnd ? "7" : "5");
    circle.setAttribute("class", isEnd ? "path-node path-node-end" : "path-node");
    svg.appendChild(circle);
  });
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
      cell.textContent = board[r][c].face;
      cell.addEventListener("pointerdown", onTilePointerDown);
      cell.addEventListener("pointerenter", onTilePointerEnter);
      els.board.appendChild(cell);
    }
  }
  ensurePathResizeObserver();
  requestAnimationFrame(() => updatePathLine());
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
  requestAnimationFrame(() => updatePathLine());
}

/** Screen y increases downward; (dr,dc) row+ is down, col+ is right. */
const OCTANT_DIRS = [
  { dr: -1, dc: 0, ang: -Math.PI / 2 },
  { dr: -1, dc: 1, ang: -Math.PI / 4 },
  { dr: 0, dc: 1, ang: 0 },
  { dr: 1, dc: 1, ang: Math.PI / 4 },
  { dr: 1, dc: 0, ang: Math.PI / 2 },
  { dr: 1, dc: -1, ang: (3 * Math.PI) / 4 },
  { dr: 0, dc: -1, ang: Math.PI },
  { dr: -1, dc: -1, ang: (-3 * Math.PI) / 4 },
];

function angularDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/**
 * Pick which neighbor of the path end the user is aiming at (octant from last tile center).
 * Avoids elementFromPoint missing gaps and favoring left/right over diagonals.
 */
function neighborFromPointer(lastR, lastC, clientX, clientY) {
  const tile = els.board.querySelector(`[data-r="${lastR}"][data-c="${lastC}"]`);
  if (!tile) return null;
  const rect = tile.getBoundingClientRect();
  // No neighbor until the pointer has left the *current* path tile. Angle-from-center
  // alone mis-reads corners/diagonals while you're still inside this cell.
  if (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  ) {
    return null;
  }

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const angle = Math.atan2(dy, dx);
  let best = OCTANT_DIRS[0];
  let bestDiff = angularDiff(angle, best.ang);
  for (let i = 1; i < OCTANT_DIRS.length; i++) {
    const d = OCTANT_DIRS[i];
    const diff = angularDiff(angle, d.ang);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }

  const nr = lastR + best.dr;
  const nc = lastC + best.dc;
  if (nr < 0 || nr > 3 || nc < 0 || nc > 3) return null;
  return [nr, nc];
}

function applyPointerToPath(clientX, clientY) {
  if (!dragging || !timerId || !path.length) return;
  const last = path[path.length - 1];
  const hit = neighborFromPointer(last[0], last[1], clientX, clientY);
  if (!hit) return;
  extendPathTo(hit[0], hit[1]);
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
  applyPointerToPath(e.clientX, e.clientY);
}

function onWindowPointerMove(e) {
  if (!dragging || !timerId) return;
  applyPointerToPath(e.clientX, e.clientY);
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

function resetMpState() {
  mp.active = false;
  mp.role = null;
  mp.roomId = null;
  mp.secret = null;
  mp.endsAt = null;
  clearMpPollers();
  els.mpRolePill.hidden = true;
}

function enterMultiGameFromState(st) {
  clearMpPollers();
  board = st.board;
  mp.endsAt = st.endsAt;
  mp.active = true;
  score = 0;
  foundWords = new Set();
  path = [];
  dragging = false;

  els.score.textContent = "0";
  els.foundList.replaceChildren();
  els.foundCount.textContent = "0";
  els.timer.classList.remove("low", "critical");
  els.currentWord.textContent = "—";

  renderBoard();
  updatePathUI();

  els.setup.hidden = true;
  els.game.hidden = false;
  els.modalEnd.hidden = true;
  els.modalMpResult.hidden = true;
  els.modalMpWait.hidden = true;
  els.mpRolePill.hidden = false;
  els.mpRolePill.textContent = mp.role === "host" ? "You are Host" : "You are Guest";

  if (mp.endsAt != null && Date.now() >= mp.endsAt) {
    secondsLeft = 0;
    els.timer.textContent = formatTime(0);
    endRound();
    return;
  }

  startGameTimer();
}

function showMpResultFromState(st) {
  const hs = st.hostScore ?? 0;
  const gs = st.guestScore ?? 0;
  let outcome = "";
  if (mp.role === "host") {
    if (hs > gs) outcome = "You win!";
    else if (gs > hs) outcome = "Opponent wins.";
    else outcome = "Tie game!";
  } else {
    if (gs > hs) outcome = "You win!";
    else if (hs > gs) outcome = "Opponent wins.";
    else outcome = "Tie game!";
  }
  els.mpResultTitle.textContent = outcome;
  els.mpResultBody.textContent = "Highest score wins — same letters, same time limit.";
  els.mpResultScores.textContent = `Host ${hs} pts · Guest ${gs} pts`;
  els.modalMpResult.hidden = false;
  els.modalEnd.hidden = true;
  stopGameTimer();
}

async function submitMpScoreAndFinish() {
  if (!mp.active || !mp.roomId || !mp.secret || !mp.role) return;
  try {
    const sub = await mpPost("submit", {
      roomId: mp.roomId,
      role: mp.role,
      secret: mp.secret,
      score,
      wordCount: foundWords.size,
    });
    if (sub.bothDone) {
      const fin = { hostScore: sub.hostScore, guestScore: sub.guestScore };
      showMpResultFromState(fin);
      submitMpLeaderboardFromState(fin);
      els.modalMpWait.hidden = true;
    } else {
      els.modalMpWait.hidden = false;
      mpResultPollTimer = setInterval(async () => {
        try {
          const st = await mpFetchState(mp.roomId, mp.role, mp.secret);
          if (st.hostSubmitted && st.guestSubmitted) {
            clearInterval(mpResultPollTimer);
            mpResultPollTimer = null;
            const fin = { hostScore: st.hostScore, guestScore: st.guestScore };
            showMpResultFromState(fin);
            submitMpLeaderboardFromState(fin);
            els.modalMpWait.hidden = true;
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    }
  } catch (e) {
    els.modalMpWait.textContent = `Could not submit score: ${e.message}`;
    els.modalMpWait.hidden = false;
  }
}

function endRound() {
  stopGameTimer();
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

  if (mp.active) {
    els.modalMpWait.hidden = true;
    els.modalMpWait.textContent = "Sending score… waiting for opponent to finish.";
    els.modalEnd.hidden = false;
    submitMpScoreAndFinish();
  } else {
    els.modalMpWait.hidden = true;
    els.modalMpWait.textContent = "Sending score… waiting for opponent to finish.";
    els.modalEnd.hidden = false;
    if (authToken && score > 0) void submitLeaderboardDelta(score);
  }
}

function startSoloRound() {
  resetMpState();
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
  els.modalMpResult.hidden = true;
  els.modalMpWait.hidden = true;

  startGameTimer();
}

async function createMultiplayerRoom() {
  if (!wordSet || wordSet.size === 0) {
    els.loadStatus.hidden = false;
    els.loadStatus.textContent = "Dictionary not ready.";
    return;
  }
  els.btnCreateMp.disabled = true;
  els.loadStatus.hidden = false;
  els.loadStatus.textContent = "Creating room…";
  try {
    let minutes = Number(els.durationInput.value);
    if (!Number.isFinite(minutes)) minutes = 2;
    minutes = Math.min(MAX_ROUND_MIN, Math.max(MIN_ROUND_MIN, Math.round(minutes)));
    const b = rollBoard();
    const data = await mpPost("create", { board: b, durationMinutes: minutes });
    const guestUrl = `${window.location.origin}${window.location.pathname}?mp=${encodeURIComponent(data.roomId)}&p=guest&s=${encodeURIComponent(data.guestSecret)}`;
    saveMpSession(data.roomId, {
      guestUrl,
      hostSecret: data.hostSecret,
      guestSecret: data.guestSecret,
    });
    mp.roomId = data.roomId;
    mp.role = "host";
    mp.secret = data.hostSecret;
    setHostUrl(data.roomId, data.hostSecret);
    els.mpGuestUrl.value = guestUrl;
    resetHostOpponentStatusUI();
    els.mpHostLobby.hidden = false;
    els.loadStatus.hidden = true;
    startHostLobbyPolling();
  } catch (e) {
    els.loadStatus.hidden = false;
    els.loadStatus.textContent = e.message || String(e);
  } finally {
    els.btnCreateMp.disabled = false;
  }
}

async function hostBeginMatch() {
  if (!mp.roomId || !mp.secret) return;
  if (hostLobbyPollTimer) {
    clearInterval(hostLobbyPollTimer);
    hostLobbyPollTimer = null;
  }
  els.btnMpBegin.disabled = true;
  els.loadStatus.hidden = false;
  els.loadStatus.textContent = "Starting match…";
  try {
    const data = await mpPost("start", { roomId: mp.roomId, secret: mp.secret });
    mp.active = true;
    mp.role = "host";
    mp.secret = mp.secret;
    mp.endsAt = data.endsAt;
    enterMultiGameFromState(data);
    els.loadStatus.hidden = true;
  } catch (e) {
    els.loadStatus.hidden = false;
    els.loadStatus.textContent = e.message || String(e);
  } finally {
    els.btnMpBegin.disabled = false;
  }
}

function startGuestPolling() {
  if (!mp.roomId || !mp.secret || mp.role !== "guest") return;
  clearMpPollers();
  mpPollTimer = setInterval(async () => {
    try {
      const st = await mpFetchState(mp.roomId, "guest", mp.secret);
      if (st.endsAt) {
        clearInterval(mpPollTimer);
        mpPollTimer = null;
        if (Date.now() >= st.endsAt) {
          els.mpGuestMsg.textContent = "This match already ended. Ask your host for a new link.";
          return;
        }
        mp.active = true;
        mp.endsAt = st.endsAt;
        enterMultiGameFromState(st);
      }
    } catch {
      els.mpGuestMsg.textContent = "Could not reach server. Check multiplayer setup (Redis env vars).";
    }
  }, 1200);
}

async function resumeHostFromUrl() {
  const params = parseMpUrl();
  if (!params || params.role !== "host") return;
  mp.roomId = params.roomId;
  mp.role = "host";
  mp.secret = params.secret;
  setModeTab(false);
  els.multiPanel.hidden = false;
  els.soloPanel.hidden = true;
  const saved = loadMpSession(params.roomId);
  if (saved?.guestUrl) {
    els.mpGuestUrl.value = saved.guestUrl;
    els.mpHostLobby.hidden = false;
  } else {
    els.mpHostLobby.hidden = false;
    els.mpGuestUrl.value = "(Create a new room to get a guest link — session expired.)";
  }
  try {
    const st = await mpFetchState(params.roomId, "host", params.secret);
    if (st.endsAt) {
      if (st.hostSubmitted && st.guestSubmitted) {
        showMpResultFromState({ hostScore: st.hostScore, guestScore: st.guestScore });
        els.setup.hidden = false;
        els.game.hidden = true;
        return;
      }
      if (Date.now() < st.endsAt) {
        mp.active = true;
        mp.endsAt = st.endsAt;
        enterMultiGameFromState(st);
        return;
      }
      mp.active = true;
      mp.endsAt = st.endsAt;
      enterMultiGameFromState(st);
      return;
    }
    if (st.guestJoined) setHostOpponentJoinedUI(true);
    else startHostLobbyPolling();
  } catch (e) {
    els.loadStatus.hidden = false;
    els.loadStatus.textContent = e.message || String(e);
  }
}

async function resumeGuestFromUrl() {
  const params = parseMpUrl();
  if (!params || params.role !== "guest") return;
  mp.roomId = params.roomId;
  mp.role = "guest";
  mp.secret = params.secret;
  setModeTab(false);
  els.multiPanel.hidden = false;
  els.soloPanel.hidden = true;
  els.mpGuestWait.hidden = false;
  try {
    const st = await mpFetchState(params.roomId, "guest", params.secret);
    if (st.hostSubmitted && st.guestSubmitted) {
      showMpResultFromState({ hostScore: st.hostScore, guestScore: st.guestScore });
      return;
    }
    if (st.endsAt) {
      mp.active = true;
      mp.endsAt = st.endsAt;
      enterMultiGameFromState(st);
      return;
    }
    startGuestPolling();
  } catch (e) {
    els.mpGuestMsg.textContent = e.message || String(e);
  }
}

function backToMenu() {
  clearMpPollers();
  resetMpState();
  els.modalMpResult.hidden = true;
  els.modalEnd.hidden = true;
  els.setup.hidden = false;
  els.game.hidden = true;
  history.replaceState(null, "", window.location.pathname);
  els.mpHostLobby.hidden = true;
  els.mpGuestWait.hidden = true;
  resetHostOpponentStatusUI();
  setModeTab(true);
}

async function loadDictionary() {
  els.loadStatus.hidden = false;
  els.loadStatus.textContent = "Loading dictionary…";
  els.btnStart.disabled = true;
  els.btnCreateMp.disabled = true;
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
    els.btnCreateMp.disabled = false;
  }
}

els.tabSolo.addEventListener("click", () => setModeTab(true));
els.tabMulti.addEventListener("click", () => setModeTab(false));

els.durationSlider.addEventListener("input", () => syncDurationControls(true));
els.durationInput.addEventListener("change", () => syncDurationControls(false));

els.btnStart.addEventListener("click", () => {
  if (!wordSet || wordSet.size === 0) {
    els.loadStatus.hidden = false;
    els.loadStatus.textContent = "Dictionary not ready. Check words.json and use a local server.";
    return;
  }
  startSoloRound();
});

els.btnCreateMp.addEventListener("click", () => createMultiplayerRoom());
els.btnCopyGuest.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.mpGuestUrl.value);
    els.btnCopyGuest.textContent = "Copied!";
    setTimeout(() => {
      els.btnCopyGuest.textContent = "Copy";
    }, 2000);
  } catch {
    els.mpGuestUrl.select();
    document.execCommand("copy");
  }
});
els.btnMpBegin.addEventListener("click", () => hostBeginMatch());

els.btnEndEarly.addEventListener("click", endRound);
els.btnPlayAgain.addEventListener("click", () => {
  if (mp.active || mp.roomId) {
    backToMenu();
  } else {
    els.modalEnd.hidden = true;
    els.setup.hidden = false;
    els.game.hidden = true;
  }
});
els.btnMpDone.addEventListener("click", () => backToMenu());

loadStoredAuth();
updateAuthBar();

for (const modal of [els.modalRegister, els.modalLogin, els.modalLeaderboard]) {
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

els.btnOpenRegister?.addEventListener("click", () => {
  if (els.regMsg) els.regMsg.textContent = "";
  if (els.modalRegister) els.modalRegister.hidden = false;
});

els.btnOpenLogin?.addEventListener("click", () => {
  if (els.loginMsg) els.loginMsg.textContent = "";
  syncLoginModalLayout();
  if (els.modalLogin) els.modalLogin.hidden = false;
});

els.btnOpenLb?.addEventListener("click", () => void openLeaderboardModal());

els.btnLbClose?.addEventListener("click", () => {
  if (els.modalLeaderboard) els.modalLeaderboard.hidden = true;
});

els.btnRegisterCancel?.addEventListener("click", () => {
  if (els.modalRegister) els.modalRegister.hidden = true;
});

els.btnLoginCancel?.addEventListener("click", () => {
  if (els.modalLogin) els.modalLogin.hidden = true;
});

els.btnRegisterSubmit?.addEventListener("click", async () => {
  if (!els.regMsg || !els.regUsername || !els.regPassword) return;
  els.regMsg.textContent = "";
  const username = els.regUsername.value.trim();
  const password = els.regPassword.value;
  const { ok, data, status } = await authPost("register", { username, password });
  if (!ok) {
    els.regMsg.textContent =
      data.message ||
      (status === 503 ? "Server misconfiguration: add Redis URL/token to .env.local or Vercel env." : "") ||
      data.error ||
      "Could not register.";
    return;
  }
  applyAuthResponse(data);
  if (els.modalRegister) els.modalRegister.hidden = true;
  els.regPassword.value = "";
});

els.btnLoginSubmit?.addEventListener("click", async () => {
  if (!els.loginMsg || !els.loginUsername || !els.loginPassword) return;
  els.loginMsg.textContent = "";
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  const { ok, data, status } = await authPost("login", { username, password });
  if (!ok) {
    els.loginMsg.textContent =
      data.message ||
      (status === 503 ? "Server misconfiguration (see API message in devtools)." : "") ||
      data.error ||
      "Could not log in.";
    return;
  }
  applyAuthResponse(data);
  if (els.modalLogin) els.modalLogin.hidden = true;
  els.loginPassword.value = "";
});

els.btnLoginLogout?.addEventListener("click", () => {
  clearAuth();
  syncLoginModalLayout();
});

window.addEventListener("pointermove", onWindowPointerMove);
window.addEventListener("pointerup", onGlobalPointerUp);
window.addEventListener("pointercancel", onGlobalPointerUp);

syncDurationControls(true);

(async () => {
  await loadDictionary();
  await refreshAuthMe();
  const q = parseMpUrl();
  if (q?.role === "host") await resumeHostFromUrl();
  else if (q?.role === "guest") await resumeGuestFromUrl();
})();
