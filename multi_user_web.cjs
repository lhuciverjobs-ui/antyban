const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { URL } = require("url");
const { fork } = require("child_process");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "multi_user_data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PUBLIC_DIR = path.join(ROOT, "public_multi");
const WORKER_FILE = path.join(ROOT, "web_user_worker.cjs");
const MESSAGES_FILE = path.join(ROOT, "pesan.txt");
const AUTH_DIR = path.join(ROOT, ".wwebjs_multi_auth");

const TOKENS = new Map();
const STREAMS = new Map();
const REFRESH_QUEUE = new Map();
const RATE_LIMITS = new Map();
const WORKERS = new Map();

boot();

function boot() {
  ensureDir(DATA_DIR);
  ensureDir(PUBLIC_DIR);
  ensureDir(AUTH_DIR);
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getLanAddresses() {
  const result = [];
  const nets = os.networkInterfaces();

  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      result.push(net.address);
    }
  }

  return [...new Set(result)];
}

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(db) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function defaults() {
  return {
    account1: { label: "Akun 1", phone: "" },
    account2: { label: "Akun 2", phone: "" },
    intervalMinSec: 10,
    intervalMaxSec: 20,
  };
}

function resetSlotConfig(config, accountKey) {
  const base = defaults();
  return sanitizeConfig({
    ...base,
    ...config,
    [accountKey]: base[accountKey],
  });
}

function blankAccount() {
  return {
    status: "idle",
    method: null,
    preferredMethod: "pairing",
    qrDataUrl: null,
    pairingCode: null,
    lastError: null,
    phone: null,
  };
}

function blankRuntime() {
  return {
    accounts: {
      account1: blankAccount(),
      account2: blankAccount(),
    },
    bot: { running: false },
    logs: [],
    worker: { online: false, pid: null, lastError: null },
  };
}

function sanitizeConfig(input = {}) {
  const base = defaults();
  return {
    account1: {
      label: String(input.account1?.label || base.account1.label).trim() || base.account1.label,
      phone: String(input.account1?.phone || "").trim(),
    },
    account2: {
      label: String(input.account2?.label || base.account2.label).trim() || base.account2.label,
      phone: String(input.account2?.phone || "").trim(),
    },
    intervalMinSec: clamp(input.intervalMinSec, 1, 3600, base.intervalMinSec),
    intervalMaxSec: clamp(input.intervalMaxSec, 1, 3600, base.intervalMaxSec),
  };
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, user) {
  const check = hashPassword(password, user.passwordSalt).hash;
  return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function userPublic(user) {
  return { id: user.id, username: user.username, config: user.config || defaults() };
}

function getUserById(id) {
  return readUsers().users.find((u) => u.id === id) || null;
}

function getUserByName(username) {
  const normalized = String(username || "").trim().toLowerCase();
  return readUsers().users.find((u) => u.username === normalized) || null;
}

function updateUser(id, fn) {
  const db = readUsers();
  const index = db.users.findIndex((u) => u.id === id);
  if (index < 0) throw new Error("User tidak ditemukan.");
  db.users[index] = fn(db.users[index]);
  saveUsers(db);
  return db.users[index];
}

function parse(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON tidak valid."));
      }
    });
    req.on("error", reject);
  });
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendFile(res, file) {
  if (!fs.existsSync(file)) return json(res, 404, { error: "File tidak ditemukan." });
  const ext = path.extname(file);
  const type = ext === ".html"
    ? "text/html; charset=utf-8"
    : ext === ".css"
      ? "text/css; charset=utf-8"
      : "application/javascript; charset=utf-8";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
}

function auth(req, res) {
  const token = req.headers["x-auth-token"];
  const session = token && TOKENS.get(token);
  if (!session) {
    json(res, 401, { error: "Belum login." });
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) {
    TOKENS.delete(token);
    json(res, 401, { error: "Sesi tidak valid." });
    return null;
  }
  return user;
}

function clientIp(req) {
  return String(
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ).split(",")[0].trim();
}

function limit(req, res, key, max, windowMs, message) {
  const bucketKey = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const bucket = RATE_LIMITS.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    RATE_LIMITS.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (bucket.count >= max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(retryAfter),
    });
    res.end(JSON.stringify({ error: message || "Terlalu banyak request." }));
    return true;
  }

  bucket.count += 1;
  return false;
}

function streamSet(userId) {
  if (!STREAMS.has(userId)) STREAMS.set(userId, new Set());
  return STREAMS.get(userId);
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function dashboard(user) {
  const entry = WORKERS.get(user.id);
  const runtime = entry?.state || blankRuntime();
  return {
    user: userPublic(user),
    accounts: runtime.accounts,
    bot: runtime.bot,
    logs: runtime.logs,
    worker: runtime.worker,
  };
}

function pushDashboard(userId) {
  const user = getUserById(userId);
  if (!user) return;
  const watchers = STREAMS.get(userId);
  if (!watchers || !watchers.size) return;
  const payload = dashboard(user);
  for (const res of watchers) {
    try {
      writeSse(res, "dashboard", payload);
    } catch {}
  }
}

function scheduleDashboardRefresh(userId, delay = 250) {
  if (REFRESH_QUEUE.has(userId)) return;
  const timer = setTimeout(() => {
    REFRESH_QUEUE.delete(userId);
    pushDashboard(userId);
  }, delay);
  REFRESH_QUEUE.set(userId, timer);
}

function openDashboardStream(req, res, user) {
  const watchers = streamSet(user.id);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(": connected\n\n");
  watchers.add(res);
  writeSse(res, "dashboard", dashboard(user));

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    watchers.delete(res);
    if (!watchers.size) STREAMS.delete(user.id);
  });
}

function updateWorkerState(userId, patch = {}) {
  let entry = WORKERS.get(userId);
  if (!entry) {
    entry = {
      child: null,
      state: blankRuntime(),
      requests: new Map(),
      seq: 0,
    };
    WORKERS.set(userId, entry);
  }

  entry.state = {
    ...entry.state,
    ...patch,
    accounts: patch.accounts || entry.state.accounts,
    bot: patch.bot || entry.state.bot,
    logs: patch.logs || entry.state.logs,
    worker: {
      ...entry.state.worker,
      ...(patch.worker || {}),
    },
  };
  scheduleDashboardRefresh(userId);
  return entry;
}

function rejectWorkerRequests(entry, message) {
  for (const pending of entry.requests.values()) {
    pending.reject(new Error(message));
  }
  entry.requests.clear();
}

function attachWorkerEvents(userId, child) {
  child.on("message", (message) => {
    const entry = WORKERS.get(userId);
    if (!entry) return;

    if (message.type === "snapshot") {
      updateWorkerState(userId, message.snapshot);
      return;
    }

    if (message.type === "response") {
      const pending = entry.requests.get(message.requestId);
      if (!pending) return;
      entry.requests.delete(message.requestId);
      if (message.ok) {
        if (message.snapshot) updateWorkerState(userId, message.snapshot);
        pending.resolve(message.snapshot || entry.state);
      } else {
        pending.reject(new Error(message.error || "Perintah worker gagal."));
      }
    }
  });

  child.on("exit", (code, signal) => {
    const entry = WORKERS.get(userId);
    if (!entry) return;
    entry.child = null;
    entry.state = {
      ...entry.state,
      worker: {
        online: false,
        pid: null,
        lastError: `worker berhenti${code !== null ? ` (code ${code})` : ""}${signal ? ` signal ${signal}` : ""}`,
      },
    };
    rejectWorkerRequests(entry, "Worker user berhenti.");
    scheduleDashboardRefresh(userId);
  });
}

function spawnWorker(user) {
  const child = fork(WORKER_FILE, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      WORKER_USER_ID: user.id,
      WORKER_ROOT: ROOT,
      WORKER_AUTH_DIR: AUTH_DIR,
      WORKER_MESSAGES_FILE: MESSAGES_FILE,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  const entry = updateWorkerState(user.id, {
    worker: { online: true, pid: child.pid, lastError: null },
  });
  entry.child = child;
  attachWorkerEvents(user.id, child);
  child.send({
    type: "init",
    user: userPublic(user),
  });
  return entry;
}

function ensureWorker(user) {
  const existing = WORKERS.get(user.id);
  if (existing?.child && existing.child.connected) return existing;
  return spawnWorker(user);
}

function sendWorkerCommand(user, command, payload = {}) {
  const entry = ensureWorker(user);
  return new Promise((resolve, reject) => {
    const requestId = `${user.id}_${++entry.seq}`;
    entry.requests.set(requestId, { resolve, reject });
    try {
      entry.child.send({
        type: "command",
        requestId,
        command,
        payload,
        user: userPublic(user),
      });
    } catch (error) {
      entry.requests.delete(requestId);
      reject(error);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/") return sendFile(res, path.join(PUBLIC_DIR, "index.html"));
  if (req.method === "GET" && url.pathname === "/app.js") return sendFile(res, path.join(PUBLIC_DIR, "app.js"));
  if (req.method === "GET" && url.pathname === "/styles.css") return sendFile(res, path.join(PUBLIC_DIR, "styles.css"));

  if (req.method === "POST" && url.pathname === "/api/register") {
    try {
      if (limit(req, res, "register", 8, 60_000, "Terlalu banyak percobaan daftar. Coba lagi sebentar.")) return;
      const body = await parse(req);
      const db = readUsers();
      const username = String(body.username || "").trim().toLowerCase();
      if (!username || !body.password) throw new Error("Username dan password wajib diisi.");
      if (db.users.some((u) => u.username === username)) throw new Error("Username sudah dipakai.");
      const pass = hashPassword(String(body.password));
      const user = {
        id: uid("user"),
        username,
        passwordSalt: pass.salt,
        passwordHash: pass.hash,
        config: defaults(),
      };
      db.users.push(user);
      saveUsers(db);
      return json(res, 201, { user: userPublic(user) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    try {
      if (limit(req, res, "login", 20, 60_000, "Terlalu banyak percobaan login. Coba lagi sebentar.")) return;
      const body = await parse(req);
      const user = getUserByName(body.username);
      if (!user || !verifyPassword(String(body.password || ""), user)) {
        return json(res, 401, { error: "Username atau password salah." });
      }
      const token = uid("token");
      TOKENS.set(token, { userId: user.id });
      return json(res, 200, { token, user: userPublic(user) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = req.headers["x-auth-token"];
    if (token) TOKENS.delete(token);
    return json(res, 200, { ok: true });
  }

  const streamToken = req.method === "GET" && url.pathname === "/api/events"
    ? url.searchParams.get("token")
    : null;
  if (req.method === "GET" && url.pathname === "/api/events" && streamToken) {
    req.headers["x-auth-token"] = streamToken;
  }

  const user = auth(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    return json(res, 200, dashboard(user));
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    return openDashboardStream(req, res, user);
  }

  if (req.method === "POST" && url.pathname === "/api/config") {
    try {
      const body = await parse(req);
      const updated = updateUser(user.id, (current) => ({ ...current, config: sanitizeConfig(body) }));
      await sendWorkerCommand(updated, "update_config", { config: updated.config });
      return json(res, 200, dashboard(updated));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/connect") {
    try {
      const body = await parse(req);
      if (!["account1", "account2"].includes(body.accountKey)) throw new Error("accountKey tidak valid.");
      await sendWorkerCommand(user, "connect", {
        accountKey: body.accountKey,
        method: body.method === "qr" ? "qr" : "pairing",
      });
      return json(res, 200, dashboard(getUserById(user.id)));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/disconnect") {
    try {
      const body = await parse(req);
      if (!["account1", "account2"].includes(body.accountKey)) throw new Error("accountKey tidak valid.");
      const accountKey = body.accountKey;
      await sendWorkerCommand(user, "disconnect", { accountKey });
      const updated = updateUser(user.id, (current) => ({
        ...current,
        config: resetSlotConfig(current.config || defaults(), accountKey),
      }));
      await sendWorkerCommand(updated, "update_config", { config: updated.config });
      return json(res, 200, dashboard(updated));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bot/start") {
    try {
      await sendWorkerCommand(user, "bot_start");
      return json(res, 200, dashboard(getUserById(user.id)));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bot/stop") {
    try {
      await sendWorkerCommand(user, "bot_stop");
      return json(res, 200, dashboard(getUserById(user.id)));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  return json(res, 404, { error: "Endpoint tidak ditemukan." });
});

server.listen(PORT, HOST, () => {
  const bindHost = HOST === "0.0.0.0" ? "0.0.0.0 (semua interface)" : HOST;
  console.log(`Multi-user web aktif pada ${bindHost}:${PORT}`);
  const lanUrls = getLanAddresses().map((ip) => `http://${ip}:${PORT}`);
  if (lanUrls.length) {
    console.log("URL yang bisa dibuka teman satu jaringan:");
    for (const url of lanUrls) console.log(`- ${url}`);
  } else {
    console.log("Tidak ada alamat LAN terdeteksi. Cek koneksi jaringan perangkat ini.");
  }
  console.log("Kalau teman dari luar jaringan mau buka, pakai hosting publik atau tunnel seperti Cloudflare Tunnel/ngrok.");
});
