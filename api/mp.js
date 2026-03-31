const { Redis } = require("@upstash/redis");
const { randomBytes } = require("crypto");

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function roomKey(id) {
  return `wh:room:${id}`;
}

function isValidBoard(b) {
  if (!Array.isArray(b) || b.length !== 4) return false;
  return b.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 4 &&
      row.every((cell) => cell && typeof cell.face === "string" && typeof cell.piece === "string")
  );
}

function parseRoom(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
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

function getAction(req, body) {
  const fromQ = readQuery(req, "action");
  if (fromQ) return fromQ;
  if (body && body.action) return String(body.action);
  return "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const r = getRedis();
  if (!r) {
    res.status(503).json({
      error: "missing_redis",
      message:
        "Add Upstash Redis: create a database at upstash.com, then set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local (vercel dev) or Vercel project env.",
    });
    return;
  }

  let body = {};
  if (req.method === "POST") {
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    } catch {
      body = {};
    }
  }

  const action = getAction(req, body);

  try {
    if (action === "create" && req.method === "POST") {
      const { board, durationMinutes } = body;
      const dm = Number(durationMinutes);
      if (!isValidBoard(board) || !Number.isFinite(dm) || dm < 1 || dm > 60) {
        res.status(400).json({ error: "invalid_body", message: "Invalid board or duration." });
        return;
      }
      const roomId = randomBytes(6).toString("hex");
      const hostSecret = randomBytes(16).toString("hex");
      const guestSecret = randomBytes(16).toString("hex");
      const room = {
        board,
        durationMin: Math.round(dm),
        hostSecret,
        guestSecret,
        endsAt: null,
        hostScore: null,
        guestScore: null,
        hostWords: 0,
        guestWords: 0,
        hostSubmitted: false,
        guestSubmitted: false,
      };
      await r.set(roomKey(roomId), JSON.stringify(room), { ex: 86400 });
      res.status(200).json({ roomId, hostSecret, guestSecret });
      return;
    }

    if (action === "start" && req.method === "POST") {
      const { roomId, secret } = body;
      const raw = await r.get(roomKey(roomId));
      const room = parseRoom(raw);
      if (!room) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (secret !== room.hostSecret) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (room.endsAt) {
        res.status(200).json({
          endsAt: room.endsAt,
          board: room.board,
          durationMin: room.durationMin,
        });
        return;
      }
      const endsAt = Date.now() + room.durationMin * 60 * 1000;
      room.endsAt = endsAt;
      await r.set(roomKey(roomId), JSON.stringify(room), { ex: 86400 });
      res.status(200).json({
        endsAt,
        board: room.board,
        durationMin: room.durationMin,
      });
      return;
    }

    if (action === "state" && req.method === "GET") {
      const roomId = readQuery(req, "roomId");
      const role = readQuery(req, "p");
      const secret = readQuery(req, "s");
      const raw = await r.get(roomKey(roomId));
      const room = parseRoom(raw);
      if (!room) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const okHost = role === "host" && secret === room.hostSecret;
      const okGuest = role === "guest" && secret === room.guestSecret;
      if (!okHost && !okGuest) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(200).json({
        endsAt: room.endsAt,
        board: room.board,
        durationMin: room.durationMin,
        hostScore: room.hostScore,
        guestScore: room.guestScore,
        hostSubmitted: room.hostSubmitted,
        guestSubmitted: room.guestSubmitted,
        hostWords: room.hostWords,
        guestWords: room.guestWords,
        serverNow: Date.now(),
      });
      return;
    }

    if (action === "submit" && req.method === "POST") {
      const { roomId, role, secret, score: scoreVal, wordCount } = body;
      const raw = await r.get(roomKey(roomId));
      const room = parseRoom(raw);
      if (!room) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (role === "host" && secret !== room.hostSecret) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (role === "guest" && secret !== room.guestSecret) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const s = Number(scoreVal);
      const wc = Number(wordCount) | 0;
      if (!Number.isFinite(s) || s < 0 || s > 1e9) {
        res.status(400).json({ error: "invalid_score" });
        return;
      }
      if (role === "host") {
        room.hostScore = s;
        room.hostWords = wc;
        room.hostSubmitted = true;
      } else {
        room.guestScore = s;
        room.guestWords = wc;
        room.guestSubmitted = true;
      }
      let winner = null;
      if (room.hostSubmitted && room.guestSubmitted) {
        if (room.hostScore === room.guestScore) winner = "tie";
        else if (room.hostScore > room.guestScore) winner = "host";
        else winner = "guest";
      }
      await r.set(roomKey(roomId), JSON.stringify(room), { ex: 86400 });
      res.status(200).json({
        ok: true,
        bothDone: !!(room.hostSubmitted && room.guestSubmitted),
        winner,
        hostScore: room.hostScore,
        guestScore: room.guestScore,
      });
      return;
    }

    res.status(400).json({
      error: "unknown_action",
      message: action ? `Unknown action: ${action}` : "Missing action. Use create, start, state, or submit.",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
};
