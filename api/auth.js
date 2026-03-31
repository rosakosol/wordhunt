import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getRedis } from "./redis-client.js";

const LB_KEY = "wh:lb";
const userKey = (u) => `wh:auth:user:${u.toLowerCase()}`;

function authSecret() {
  const s = (process.env.AUTH_SECRET || process.env.WORDHUNT_AUTH_SECRET || "").trim();
  if (!s || s.length < 16) return null;
  return s;
}

function signToken(username) {
  const secret = authSecret();
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  const secret = authSecret();
  if (!secret || !token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data.u || typeof data.exp !== "number" || data.exp < Date.now()) return null;
  return String(data.u);
}

function readQuery(req, key) {
  const q = req.query || {};
  if (q[key] != null && q[key] !== "") return String(q[key]);
  try {
    const u = new URL(req.url || "/", "https://placeholder.local");
    const v = u.searchParams.get(key);
    if (v != null && v !== "") return v;
  } catch {
    /* ignore */
  }
  return "";
}

function parseBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === "object" ? req.body : {};
}

function bearerUser(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  return verifyToken(h.slice(7).trim());
}

function validUsername(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_]{3,20}$/.test(name);
}

async function totalPointsFor(r, username) {
  const v = await r.zscore(LB_KEY, username);
  if (v == null) return 0;
  return Number(v);
}

async function rankFor(r, username) {
  const rk = await r.zrevrank(LB_KEY, username);
  if (rk == null) return null;
  return rk + 1;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const r = getRedis();
  const secretOk = authSecret();
  if (!r) {
    res.status(503).json({
      error: "redis_required",
      message:
        "Redis is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to .env.local (run `vercel env pull` if vars are on Vercel), or use KV_REST_API_URL + KV_REST_API_TOKEN for Vercel KV.",
    });
    return;
  }
  if (!secretOk) {
    res.status(503).json({
      error: "auth_secret_required",
      message:
        "Set AUTH_SECRET (or WORDHUNT_AUTH_SECRET) to at least 16 characters in .env.local or Vercel project settings.",
    });
    return;
  }

  const body = req.method === "POST" ? parseBody(req) : {};
  const action =
    req.method === "GET" ? readQuery(req, "action") : body.action || readQuery(req, "action");

  try {
    if (req.method === "GET" && action === "leaderboard") {
      const raw = await r.zrange(LB_KEY, 0, 99, { rev: true, withScores: true });
      const entries = [];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i += 2) {
          entries.push({
            rank: entries.length + 1,
            username: String(raw[i]),
            points: Number(raw[i + 1]) || 0,
          });
        }
      }
      res.status(200).json({ entries });
      return;
    }

    if (req.method === "GET" && action === "me") {
      const username = bearerUser(req);
      if (!username) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const total = await totalPointsFor(r, username);
      const rank = await rankFor(r, username);
      res.status(200).json({ username, totalPoints: total, rank });
      return;
    }

    if (req.method === "POST" && action === "register") {
      const usernameRaw = body.username;
      const password = body.password;
      if (!validUsername(usernameRaw)) {
        res.status(400).json({ error: "invalid_username", message: "Use 3–20 letters, numbers, or _." });
        return;
      }
      if (typeof password !== "string" || password.length < 8) {
        res.status(400).json({ error: "invalid_password", message: "Password must be at least 8 characters." });
        return;
      }
      const username = usernameRaw.toLowerCase();
      const key = userKey(username);
      const exists = await r.get(key);
      if (exists) {
        res.status(409).json({ error: "taken", message: "That username is already registered." });
        return;
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await r.set(key, JSON.stringify({ passwordHash }));
      await r.zadd(LB_KEY, { score: 0, member: username });
      const token = signToken(username);
      res.status(200).json({ token, username, totalPoints: 0, rank: await rankFor(r, username) });
      return;
    }

    if (req.method === "POST" && action === "login") {
      const usernameRaw = body.username;
      const password = body.password;
      if (!validUsername(usernameRaw) || typeof password !== "string") {
        res.status(400).json({ error: "invalid_credentials" });
        return;
      }
      const username = usernameRaw.toLowerCase();
      const raw = await r.get(userKey(username));
      if (!raw) {
        res.status(401).json({ error: "invalid_credentials", message: "Wrong username or password." });
        return;
      }
      let record;
      try {
        record = typeof raw === "object" ? raw : JSON.parse(String(raw));
      } catch {
        res.status(500).json({ error: "server_error" });
        return;
      }
      const ok = await bcrypt.compare(password, record.passwordHash);
      if (!ok) {
        res.status(401).json({ error: "invalid_credentials", message: "Wrong username or password." });
        return;
      }
      const total = await totalPointsFor(r, username);
      const rank = await rankFor(r, username);
      const token = signToken(username);
      res.status(200).json({ token, username, totalPoints: total, rank });
      return;
    }

    if (req.method === "POST" && action === "addScore") {
      const username = bearerUser(req);
      if (!username) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const pts = Number(body.points);
      if (!Number.isFinite(pts) || pts < 0 || pts > 1e9) {
        res.status(400).json({ error: "invalid_points" });
        return;
      }
      if (pts === 0) {
        const total = await totalPointsFor(r, username);
        const rank = await rankFor(r, username);
        res.status(200).json({ ok: true, totalPoints: total, rank });
        return;
      }
      await r.zincrby(LB_KEY, pts, username);
      const total = await totalPointsFor(r, username);
      const rank = await rankFor(r, username);
      res.status(200).json({ ok: true, totalPoints: total, rank });
      return;
    }

    res.status(400).json({ error: "unknown_action", message: "Use leaderboard, me, register, login, or addScore." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
}
