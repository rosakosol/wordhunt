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

/** Optional loop: place `audio/bgm.mp3` next to the site; falls back to soft procedural hum. */
const BGM_URL = new URL("audio/bgm.mp3", window.location.href).href;

/** One shared element so we can preload early and unlock playback on user gesture. */
/** @type {HTMLAudioElement | null} */
let bgmAudioSingleton = null;
let bgmHtmlUnlockOk = false;

function getOrCreateBgmAudio() {
  if (!bgmAudioSingleton) {
    const a = new Audio();
    a.preload = "auto";
    a.loop = true;
    a.src = BGM_URL;
    a.load();
    bgmAudioSingleton = a;
  }
  return bgmAudioSingleton;
}

/** Call synchronously inside click/pointer handlers (before any await) so HTMLAudio isn’t blocked by autoplay policy. */
function primeAudioFromUserGesture() {
  void resumeSfxContext();
  if (bgmHtmlUnlockOk) return;
  const a = getOrCreateBgmAudio();
  const prev = a.volume;
  a.volume = 0;
  const pr = a.play();
  if (pr !== undefined) {
    pr.then(() => {
      a.pause();
      a.currentTime = 0;
      a.volume = 0.22;
      bgmHtmlUnlockOk = true;
    }).catch(() => {
      a.volume = prev;
    });
  }
}

function preloadBgmAsset() {
  try {
    getOrCreateBgmAudio();
  } catch {
    /* ignore */
  }
}

const API_MP = "/api/mp";
const API_AUTH = "/api/auth";

const LS_AUTH_TOKEN = "wh_auth_token";
const LS_AUTH_USER = "wh_auth_user";

/** @type {'local' | 'session' | null} */
let authPersistKind = null;

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
let mpLiveScorePollTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let mpLivePushTimer = null;

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
  hudOpponentWrap: document.getElementById("hud-opponent-wrap"),
  opponentScore: document.getElementById("opponent-score"),
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
  mpResultHostBox: document.getElementById("mp-result-host-box"),
  mpResultGuestBox: document.getElementById("mp-result-guest-box"),
  mpResultHostScore: document.getElementById("mp-result-host-score"),
  mpResultGuestScore: document.getElementById("mp-result-guest-score"),
  mpResultHostWords: document.getElementById("mp-result-host-words"),
  mpResultGuestWords: document.getElementById("mp-result-guest-words"),
  mpResultWordsHostLabel: document.getElementById("mp-result-words-host-label"),
  mpResultWordsGuestLabel: document.getElementById("mp-result-words-guest-label"),
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
  authBtnsGuest: document.getElementById("auth-btns-guest"),
  authBtnsUser: document.getElementById("auth-btns-user"),
  btnOpenRegister: document.getElementById("btn-open-register"),
  btnOpenLogin: document.getElementById("btn-open-login"),
  btnOpenLb: document.getElementById("btn-open-lb"),
  btnLogout: document.getElementById("btn-logout"),
  modalRegister: document.getElementById("modal-register"),
  formRegister: document.getElementById("form-register"),
  modalLogin: document.getElementById("modal-login"),
  formLogin: document.getElementById("form-login"),
  modalLeaderboard: document.getElementById("modal-leaderboard"),
  regUsername: document.getElementById("reg-username"),
  regPassword: document.getElementById("reg-password"),
  btnRegTogglePassword: document.getElementById("btn-reg-toggle-password"),
  regMsg: document.getElementById("reg-msg"),
  btnRegisterSubmit: document.getElementById("btn-register-submit"),
  btnRegisterCancel: document.getElementById("btn-register-cancel"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  btnLoginTogglePassword: document.getElementById("btn-login-toggle-password"),
  loginRemember: document.getElementById("login-remember"),
  loginMsg: document.getElementById("login-msg"),
  btnLoginSubmit: document.getElementById("btn-login-submit"),
  btnLoginCancel: document.getElementById("btn-login-cancel"),
  lbTbody: document.getElementById("lb-tbody"),
  lbYou: document.getElementById("lb-you"),
  lbMsg: document.getElementById("lb-msg"),
  btnLbClose: document.getElementById("btn-lb-close"),
};

function syncAuthFormActionUrl() {
  try {
    const u = new URL(window.location.href);
    u.hash = "";
    const actionUrl = u.href;
    if (els.formRegister) els.formRegister.action = actionUrl;
    if (els.formLogin) els.formLogin.action = actionUrl;
  } catch {
    /* ignore */
  }
}
syncAuthFormActionUrl();
window.addEventListener("popstate", syncAuthFormActionUrl);

/** Ask the browser / OS to save credentials (HTTPS or localhost only). */
async function tryStorePasswordCredential(formEl) {
  if (!formEl || !window.isSecureContext) return;
  const PC = window.PasswordCredential;
  if (!PC || !navigator.credentials?.store) return;
  try {
    if (!formEl.checkValidity()) return;
    await navigator.credentials.store(new PC(formEl));
  } catch {
    /* user declined, private mode, or unsupported */
  }
}

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

/** @type {AudioContext | null} */
let sfxAudioCtx = null;
/** @type {{ html: HTMLAudioElement | null, proc: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode } | null }} */
let gameMusic = { html: null, proc: null };

function getSfxContext() {
  if (!sfxAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sfxAudioCtx = new Ctx();
  }
  return sfxAudioCtx;
}

async function resumeSfxContext() {
  const ctx = getSfxContext();
  if (!ctx) return;
  if (ctx.state === "suspended") await ctx.resume();
}

function stopProceduralBgm() {
  const p = gameMusic.proc;
  if (!p) return;
  try {
    p.o1.stop();
    p.o2.stop();
  } catch {
    /* already stopped */
  }
  gameMusic.proc = null;
}

function startProceduralBgm() {
  if (gameMusic.proc || gameMusic.html) return;
  const ctx = getSfxContext();
  if (!ctx) return;
  const g = ctx.createGain();
  g.gain.value = 0.045;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 520;
  f.Q.value = 0.7;
  g.connect(f);
  f.connect(ctx.destination);
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = "triangle";
  o2.type = "triangle";
  o1.frequency.value = 130.81;
  o2.frequency.value = 164.81;
  o1.connect(g);
  o2.connect(g);
  o1.start();
  o2.start();
  gameMusic.proc = { o1, o2, g };
}

function stopGameMusic() {
  if (gameMusic.html) {
    try {
      gameMusic.html.pause();
      gameMusic.html.currentTime = 0;
    } catch {
      /* ignore */
    }
    gameMusic.html = null;
  }
  stopProceduralBgm();
}

async function startGameMusic() {
  if (gameMusic.html || gameMusic.proc) return;
  await resumeSfxContext();
  const a = getOrCreateBgmAudio();
  a.loop = true;
  a.volume = 0.22;

  const tryPlayHtml = async () => {
    try {
      await a.play();
      gameMusic.html = a;
      return true;
    } catch {
      return false;
    }
  };

  if (a.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (await tryPlayHtml()) return;
  } else {
    await new Promise((resolve) => {
      let settled = false;
      const fin = () => {
        if (settled) return;
        settled = true;
        a.removeEventListener("canplay", fin);
        a.removeEventListener("error", fin);
        resolve();
      };
      a.addEventListener("canplay", fin, { once: true });
      a.addEventListener("error", fin, { once: true });
      setTimeout(fin, 10000);
    });
    if (await tryPlayHtml()) return;
  }
  startProceduralBgm();
}

function playWordScoreSound() {
  const ctx = getSfxContext();
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.11, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
  g.connect(ctx.destination);
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = "sine";
  o2.type = "sine";
  o1.frequency.setValueAtTime(523.25, t);
  o2.frequency.setValueAtTime(783.99, t);
  o1.connect(g);
  o2.connect(g);
  o1.start(t);
  o2.start(t);
  o1.stop(t + 0.15);
  o2.stop(t + 0.15);
}

function playInvalidWordSound() {
  const ctx = getSfxContext();
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.22, t);
  master.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
  master.connect(ctx.destination);

  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.type = "triangle";
  o2.type = "triangle";
  o1.frequency.setValueAtTime(200, t);
  o1.frequency.exponentialRampToValueAtTime(90, t + 0.17);
  o2.frequency.setValueAtTime(212, t);
  o2.frequency.exponentialRampToValueAtTime(95, t + 0.17);
  o1.connect(master);
  o2.connect(master);
  o1.start(t);
  o2.start(t);
  o1.stop(t + 0.25);
  o2.stop(t + 0.25);
}

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
  if (mpLiveScorePollTimer) {
    clearInterval(mpLiveScorePollTimer);
    mpLiveScorePollTimer = null;
  }
  if (mpLivePushTimer) {
    clearTimeout(mpLivePushTimer);
    mpLivePushTimer = null;
  }
}

function hideMpOpponentHud() {
  if (els.hudOpponentWrap) els.hudOpponentWrap.hidden = true;
  if (els.opponentScore) els.opponentScore.textContent = "—";
}

function updateOpponentScoreDisplay(value) {
  if (!els.opponentScore) return;
  els.opponentScore.textContent = value == null ? "—" : String(value);
}

/** @param {Record<string, unknown>} st */
function applyOpponentScoreFromState(st) {
  if (!mp.active || !st) return;
  let v = null;
  if (mp.role === "host") {
    if (st.guestSubmitted) v = st.guestScore != null ? Number(st.guestScore) : 0;
    else if (st.guestLiveScore != null) v = Number(st.guestLiveScore);
  } else {
    if (st.hostSubmitted) v = st.hostScore != null ? Number(st.hostScore) : 0;
    else if (st.hostLiveScore != null) v = Number(st.hostLiveScore);
  }
  updateOpponentScoreDisplay(Number.isFinite(v) ? v : null);
}

function startMpLiveScorePolling() {
  if (mpLiveScorePollTimer) {
    clearInterval(mpLiveScorePollTimer);
    mpLiveScorePollTimer = null;
  }
  if (!mp.active || !mp.roomId || !mp.secret || !mp.role) return;
  mpLiveScorePollTimer = setInterval(async () => {
    if (!mp.active || !mp.roomId || !mp.secret || !mp.role) return;
    try {
      const st = await mpFetchState(mp.roomId, mp.role, mp.secret);
      applyOpponentScoreFromState(st);
    } catch {
      /* ignore */
    }
  }, 1100);
}

async function pushMpLiveScore() {
  if (!mp.active || !mp.roomId || !mp.secret || !mp.role) return;
  try {
    await mpPost("liveScore", {
      roomId: mp.roomId,
      role: mp.role,
      secret: mp.secret,
      score,
    });
  } catch {
    /* ignore */
  }
}

function schedulePushMpLiveScore() {
  if (!mp.active) return;
  if (mpLivePushTimer) clearTimeout(mpLivePushTimer);
  mpLivePushTimer = setTimeout(() => {
    mpLivePushTimer = null;
    void pushMpLiveScore();
  }, 280);
}

function flushMpLiveScorePush() {
  if (mpLivePushTimer) {
    clearTimeout(mpLivePushTimer);
    mpLivePushTimer = null;
  }
  void pushMpLiveScore();
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
  authPersistKind = null;
  try {
    const fromLocal = localStorage.getItem(LS_AUTH_TOKEN);
    if (fromLocal) {
      authToken = fromLocal;
      authUsername = localStorage.getItem(LS_AUTH_USER) || "";
      authPersistKind = "local";
      return;
    }
    const fromSession = sessionStorage.getItem(LS_AUTH_TOKEN);
    if (fromSession) {
      authToken = fromSession;
      authUsername = sessionStorage.getItem(LS_AUTH_USER) || "";
      authPersistKind = "session";
      return;
    }
    authToken = null;
    authUsername = "";
  } catch {
    authToken = null;
    authUsername = "";
  }
  if (!authToken) {
    authToken = null;
    authUsername = "";
    authPersistKind = null;
  }
}

/** @param {boolean} [persistLocal] When true, keep token in localStorage (30-day-style login); else session tab storage. */
function applyAuthResponse(data, persistLocal = true) {
  if (!data?.token) return;
  authToken = data.token;
  authUsername = String(data.username || "");
  authTotal = Number(data.totalPoints) || 0;
  authRank = data.rank != null ? Number(data.rank) : null;
  authPersistKind = persistLocal ? "local" : "session";
  try {
    if (persistLocal) {
      sessionStorage.removeItem(LS_AUTH_TOKEN);
      sessionStorage.removeItem(LS_AUTH_USER);
      localStorage.setItem(LS_AUTH_TOKEN, authToken);
      localStorage.setItem(LS_AUTH_USER, authUsername);
    } else {
      localStorage.removeItem(LS_AUTH_TOKEN);
      localStorage.removeItem(LS_AUTH_USER);
      sessionStorage.setItem(LS_AUTH_TOKEN, authToken);
      sessionStorage.setItem(LS_AUTH_USER, authUsername);
    }
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
  authPersistKind = null;
  try {
    localStorage.removeItem(LS_AUTH_TOKEN);
    localStorage.removeItem(LS_AUTH_USER);
    sessionStorage.removeItem(LS_AUTH_TOKEN);
    sessionStorage.removeItem(LS_AUTH_USER);
  } catch {
    /* ignore */
  }
  updateAuthBar();
}

function updateAuthBar() {
  const guest = !authToken;
  if (els.authBtnsGuest) els.authBtnsGuest.hidden = !guest;
  if (els.authBtnsUser) els.authBtnsUser.hidden = guest;
  if (!els.authSummary) return;
  if (guest) {
    els.authSummary.textContent = "";
  } else {
    const pts = Number(authTotal) || 0;
    const r = authRank != null && Number.isFinite(authRank) ? ` · #${authRank} on board` : "";
    els.authSummary.textContent = `${authUsername} — ${pts} pts${r}`;
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
      if (authPersistKind === "local") {
        localStorage.setItem(LS_AUTH_USER, authUsername);
      } else if (authPersistKind === "session") {
        sessionStorage.setItem(LS_AUTH_USER, authUsername);
      }
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

/** @returns {"pending" | "valid" | "invalid" | null} */
function getPathVisualState() {
  if (!path.length) return null;
  if (!wordSet || wordSet.size === 0) return "pending";
  const word = pathToWord(board, path);
  if (word.length < MIN_WORD_LEN) return "pending";
  if (foundWords.has(word)) return "pending";
  if (!wordSet.has(word)) return "invalid";
  return "valid";
}

function updatePathUI() {
  const tiles = els.board.querySelectorAll(".tile");
  tiles.forEach((t) => {
    t.classList.remove("in-path", "last", "path-pending", "path-valid", "path-invalid");
  });
  const pathVisual = getPathVisualState();
  const stack = els.board.parentElement;
  if (stack?.classList.contains("board-stack")) {
    if (pathVisual) stack.dataset.pathVisual = pathVisual;
    else delete stack.dataset.pathVisual;
  }
  path.forEach(([r, c], idx) => {
    const t = els.board.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (t) {
      t.classList.add("in-path");
      if (pathVisual) t.classList.add(`path-${pathVisual}`);
      if (idx === path.length - 1) t.classList.add("last");
    }
  });
  const w = path.length ? pathToWord(board, path) : "";
  if (els.currentWord) {
    els.currentWord.textContent = w ? w.toUpperCase() : "—";
    els.currentWord.classList.remove("hud-word--pending", "hud-word--valid", "hud-word--invalid");
    if (pathVisual) els.currentWord.classList.add(`hud-word--${pathVisual}`);
  }
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
  if (timerId) {
    primeAudioFromUserGesture();
    if (!gameMusic.html && !gameMusic.proc) void startGameMusic();
  }
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
  if (!wordSet.has(word)) {
    void resumeSfxContext().then(() => playInvalidWordSound());
    return;
  }
  if (foundWords.has(word)) {
    void resumeSfxContext().then(() => playInvalidWordSound());
    return;
  }

  foundWords.add(word);
  const pts = scoreForWord(word.length);
  score += pts;
  els.score.textContent = String(score);
  void resumeSfxContext().then(() => playWordScoreSound());

  const li = document.createElement("li");
  li.textContent = `${word} +${pts}`;
  li.classList.add("new");
  els.foundList.prepend(li);
  els.foundCount.textContent = String(foundWords.size);
  if (mp.active) schedulePushMpLiveScore();
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
  hideMpOpponentHud();
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

  if (els.hudOpponentWrap) els.hudOpponentWrap.hidden = false;
  updateOpponentScoreDisplay(null);
  startMpLiveScorePolling();
  void mpFetchState(mp.roomId, mp.role, mp.secret).then(applyOpponentScoreFromState).catch(() => {});

  startGameTimer();
  void startGameMusic();
}

function fillMpResultWordList(ul, words) {
  if (!ul) return;
  ul.replaceChildren();
  const list = Array.isArray(words) ? words : [];
  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "mp-result-word-empty";
    li.textContent = "No words";
    ul.appendChild(li);
    return;
  }
  list.forEach((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    ul.appendChild(li);
  });
}

function showMpResultFromState(st) {
  stopGameMusic();
  if (mpResultPollTimer) {
    clearInterval(mpResultPollTimer);
    mpResultPollTimer = null;
  }
  const hs = Number(st.hostScore);
  const gs = Number(st.guestScore);
  const hostPts = Number.isFinite(hs) ? hs : 0;
  const guestPts = Number.isFinite(gs) ? gs : 0;
  let outcome = "";
  if (mp.role === "host") {
    if (hostPts > guestPts) outcome = "You win!";
    else if (guestPts > hostPts) outcome = "Opponent wins.";
    else outcome = "Tie game!";
  } else {
    if (guestPts > hostPts) outcome = "You win!";
    else if (hostPts > guestPts) outcome = "Opponent wins.";
    else outcome = "Tie game!";
  }
  els.mpResultTitle.textContent = outcome;
  if (els.mpResultHostScore) els.mpResultHostScore.textContent = String(hostPts);
  if (els.mpResultGuestScore) els.mpResultGuestScore.textContent = String(guestPts);
  if (els.mpResultHostBox) els.mpResultHostBox.classList.toggle("mp-score-you", mp.role === "host");
  if (els.mpResultGuestBox) els.mpResultGuestBox.classList.toggle("mp-score-you", mp.role === "guest");
  if (els.mpResultWordsHostLabel) {
    els.mpResultWordsHostLabel.classList.toggle("mp-result-words-you", mp.role === "host");
  }
  if (els.mpResultWordsGuestLabel) {
    els.mpResultWordsGuestLabel.classList.toggle("mp-result-words-you", mp.role === "guest");
  }
  fillMpResultWordList(els.mpResultHostWords, st.hostFoundWords ?? []);
  fillMpResultWordList(els.mpResultGuestWords, st.guestFoundWords ?? []);
  els.modalMpWait.hidden = true;
  els.modalMpWait.textContent = "Sending score… waiting for opponent to finish.";
  els.modalMpResult.hidden = false;
  els.modalEnd.hidden = true;
  stopGameTimer();
}

async function submitMpScoreAndFinish() {
  if (!mp.active || !mp.roomId || !mp.secret || !mp.role) return;
  if (mpLivePushTimer) {
    clearTimeout(mpLivePushTimer);
    mpLivePushTimer = null;
  }
  await pushMpLiveScore();
  try {
    const sub = await mpPost("submit", {
      roomId: mp.roomId,
      role: mp.role,
      secret: mp.secret,
      score,
      wordCount: foundWords.size,
      words: [...foundWords].sort(),
    });
    if (sub.bothDone) {
      const fin = {
        hostScore: sub.hostScore,
        guestScore: sub.guestScore,
        hostFoundWords: sub.hostFoundWords ?? [],
        guestFoundWords: sub.guestFoundWords ?? [],
      };
      showMpResultFromState(fin);
      submitMpLeaderboardFromState(fin);
    } else {
      els.modalMpWait.hidden = false;
      mpResultPollTimer = setInterval(async () => {
        try {
          const st = await mpFetchState(mp.roomId, mp.role, mp.secret);
          if (st.hostSubmitted && st.guestSubmitted) {
            clearInterval(mpResultPollTimer);
            mpResultPollTimer = null;
            const fin = {
              hostScore: st.hostScore,
              guestScore: st.guestScore,
              hostFoundWords: st.hostFoundWords ?? [],
              guestFoundWords: st.guestFoundWords ?? [],
            };
            showMpResultFromState(fin);
            submitMpLeaderboardFromState(fin);
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    }
  } catch (e) {
    if (els.btnPlayAgain) els.btnPlayAgain.hidden = false;
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
    if (els.btnPlayAgain) els.btnPlayAgain.hidden = true;
    if (mpLiveScorePollTimer) {
      clearInterval(mpLiveScorePollTimer);
      mpLiveScorePollTimer = null;
    }
    hideMpOpponentHud();
    els.modalMpWait.hidden = true;
    els.modalMpWait.textContent = "Sending score… waiting for opponent to finish.";
    els.modalEnd.hidden = false;
    submitMpScoreAndFinish();
  } else {
    if (els.btnPlayAgain) els.btnPlayAgain.hidden = false;
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
  if (els.btnPlayAgain) els.btnPlayAgain.hidden = false;

  startGameTimer();
  void startGameMusic();
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
  primeAudioFromUserGesture();
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
        showMpResultFromState({
          hostScore: st.hostScore,
          guestScore: st.guestScore,
          hostFoundWords: st.hostFoundWords,
          guestFoundWords: st.guestFoundWords,
        });
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
      showMpResultFromState({
        hostScore: st.hostScore,
        guestScore: st.guestScore,
        hostFoundWords: st.hostFoundWords,
        guestFoundWords: st.guestFoundWords,
      });
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
  stopGameMusic();
  clearMpPollers();
  resetMpState();
  if (els.btnPlayAgain) els.btnPlayAgain.hidden = false;
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
    preloadBgmAsset();
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
  primeAudioFromUserGesture();
  startSoloRound();
});

els.btnCreateMp.addEventListener("click", () => {
  primeAudioFromUserGesture();
  void createMultiplayerRoom();
});
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
  if (mpResultPollTimer != null) {
    return;
  }
  if (mp.active || mp.roomId) {
    backToMenu();
  } else {
    stopGameMusic();
    els.modalEnd.hidden = true;
    els.setup.hidden = false;
    els.game.hidden = true;
  }
});
els.btnMpDone.addEventListener("click", () => backToMenu());

loadStoredAuth();
updateAuthBar();

function setPasswordRevealed(input, toggleBtn, revealed) {
  if (!input) return;
  input.type = revealed ? "text" : "password";
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-pressed", revealed ? "true" : "false");
    toggleBtn.setAttribute("aria-label", revealed ? "Hide password" : "Show password");
  }
}

function resetRegisterPasswordVisibility() {
  setPasswordRevealed(els.regPassword, els.btnRegTogglePassword, false);
}

function resetLoginPasswordVisibility() {
  setPasswordRevealed(els.loginPassword, els.btnLoginTogglePassword, false);
}

els.btnRegTogglePassword?.addEventListener("click", () => {
  const reveal = els.regPassword?.type === "password";
  setPasswordRevealed(els.regPassword, els.btnRegTogglePassword, reveal);
});

els.btnLoginTogglePassword?.addEventListener("click", () => {
  const reveal = els.loginPassword?.type === "password";
  setPasswordRevealed(els.loginPassword, els.btnLoginTogglePassword, reveal);
});

for (const modal of [els.modalRegister, els.modalLogin, els.modalLeaderboard]) {
  modal?.addEventListener("click", (e) => {
    if (e.target !== modal) return;
    modal.hidden = true;
    if (modal === els.modalRegister) resetRegisterPasswordVisibility();
    if (modal === els.modalLogin) resetLoginPasswordVisibility();
  });
}

els.btnOpenRegister?.addEventListener("click", () => {
  if (els.regMsg) els.regMsg.textContent = "";
  resetRegisterPasswordVisibility();
  if (els.modalRegister) els.modalRegister.hidden = false;
});

els.btnOpenLogin?.addEventListener("click", () => {
  if (els.loginMsg) els.loginMsg.textContent = "";
  resetLoginPasswordVisibility();
  if (els.loginRemember) els.loginRemember.checked = false;
  if (els.modalLogin) els.modalLogin.hidden = false;
});

els.btnOpenLb?.addEventListener("click", () => void openLeaderboardModal());

els.btnLbClose?.addEventListener("click", () => {
  if (els.modalLeaderboard) els.modalLeaderboard.hidden = true;
});

els.btnRegisterCancel?.addEventListener("click", () => {
  resetRegisterPasswordVisibility();
  if (els.modalRegister) els.modalRegister.hidden = true;
});

els.btnLoginCancel?.addEventListener("click", () => {
  resetLoginPasswordVisibility();
  if (els.modalLogin) els.modalLogin.hidden = true;
});

function setAuthFormBusy(kind, busy) {
  const isReg = kind === "register";
  const btn = isReg ? els.btnRegisterSubmit : els.btnLoginSubmit;
  const cancel = isReg ? els.btnRegisterCancel : els.btnLoginCancel;
  const username = isReg ? els.regUsername : els.loginUsername;
  const password = isReg ? els.regPassword : els.loginPassword;
  const toggle = isReg ? els.btnRegTogglePassword : els.btnLoginTogglePassword;
  if (btn) {
    btn.classList.toggle("btn--loading", busy);
    btn.disabled = busy;
    btn.setAttribute("aria-busy", busy ? "true" : "false");
  }
  if (cancel) cancel.disabled = busy;
  if (username) username.disabled = busy;
  if (password) password.disabled = busy;
  if (toggle) toggle.disabled = busy;
  if (!isReg && els.loginRemember) els.loginRemember.disabled = busy;
}

els.formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!els.regMsg || !els.regUsername || !els.regPassword) return;
  els.regMsg.textContent = "";
  const username = els.regUsername.value.trim();
  const password = els.regPassword.value;
  setAuthFormBusy("register", true);
  try {
    const { ok, data, status } = await authPost("register", { username, password });
    if (!ok) {
      els.regMsg.textContent =
        data.message ||
        (status === 503 ? "Server misconfiguration: add Redis URL/token to .env.local or Vercel env." : "") ||
        data.error ||
        "Could not register.";
      return;
    }
    setAuthFormBusy("register", false);
    await tryStorePasswordCredential(els.formRegister);
    const displayName = String(data.username || username);
    applyAuthResponse(data);
    window.alert(`Registration successful! You are signed in as ${displayName}.`);
    if (els.modalRegister) els.modalRegister.hidden = true;
    els.regPassword.value = "";
    resetRegisterPasswordVisibility();
  } finally {
    setAuthFormBusy("register", false);
  }
});

els.formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!els.loginMsg || !els.loginUsername || !els.loginPassword) return;
  els.loginMsg.textContent = "";
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  const remember = !!els.loginRemember?.checked;
  setAuthFormBusy("login", true);
  try {
    const { ok, data, status } = await authPost("login", { username, password, remember });
    if (!ok) {
      els.loginMsg.textContent =
        data.message ||
        (status === 503 ? "Server misconfiguration (see API message in devtools)." : "") ||
        data.error ||
        "Could not log in.";
      return;
    }
    setAuthFormBusy("login", false);
    await tryStorePasswordCredential(els.formLogin);
    const displayName = String(data.username || username);
    applyAuthResponse(data, remember);
    window.alert(`Login successful! Welcome back, ${displayName}.`);
    if (els.modalLogin) els.modalLogin.hidden = true;
    els.loginPassword.value = "";
    resetLoginPasswordVisibility();
  } finally {
    setAuthFormBusy("login", false);
  }
});

els.btnLogout?.addEventListener("click", () => clearAuth());

window.addEventListener("pointermove", onWindowPointerMove);
window.addEventListener("pointerup", onGlobalPointerUp);
window.addEventListener("pointercancel", onGlobalPointerUp);

syncDurationControls(true);

(function installFirstUserGestureAudioUnlock() {
  const unlock = () => {
    primeAudioFromUserGesture();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
})();

(async () => {
  await loadDictionary();
  await refreshAuthMe();
  const q = parseMpUrl();
  if (q?.role === "host") await resumeHostFromUrl();
  else if (q?.role === "guest") await resumeGuestFromUrl();
})();
