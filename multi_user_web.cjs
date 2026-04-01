const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "multi_user_data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const AUTH_DIR = path.join(ROOT, ".wwebjs_multi_auth");
const PUBLIC_DIR = path.join(ROOT, "public_multi");
const MESSAGES_FILE = path.join(ROOT, "pesan.txt");

const TOKENS = new Map();
const RUNTIME = new Map();

boot();
registerProcessGuards();

function boot() {
  ensureDir(DATA_DIR);
  ensureDir(AUTH_DIR);
  ensureDir(PUBLIC_DIR);
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

function registerProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    if (isIgnorableWhatsAppError(reason)) {
      console.warn("[wa-guard] Ignored transient rejection:", extractErrorMessage(reason));
      return;
    }
    console.error("[unhandledRejection]", reason);
  });

  process.on("uncaughtException", (error) => {
    if (isIgnorableWhatsAppError(error)) {
      console.warn("[wa-guard] Ignored transient exception:", extractErrorMessage(error));
      return;
    }
    console.error("[uncaughtException]", error);
  });
}

function extractErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return String(error.message || error);
}

function isIgnorableWhatsAppError(error) {
  const message = extractErrorMessage(error);
  return [
    "Execution context was destroyed",
    "Cannot find context with specified id",
    "Navigating frame was detached",
    "Protocol error (Runtime.callFunctionOn)",
  ].some((text) => message.includes(text));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function formatNumber(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function chatId(phone) {
  return `${formatNumber(phone)}@c.us`;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${Math.round(ms / 1000)} detik.`)), ms);
    }),
  ]);
}

function readMessagesFromFile(filePath) {
  const defaultMessages1 = ["Halo!", "Apa kabar?", "Lagi ngapain?"];
  const defaultMessages2 = ["Baik, makasih!", "Santai nih.", "Gak ngapa-ngapain."];

  if (!fs.existsSync(filePath)) {
    return { messages1: defaultMessages1, messages2: defaultMessages2 };
  }

  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const messages1 = [];
  const messages2 = [];
  let section = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "[AKUN1]") {
      section = "account1";
      continue;
    }
    if (trimmed === "[AKUN2]") {
      section = "account2";
      continue;
    }
    if (section === "account1") messages1.push(trimmed);
    else if (section === "account2") messages2.push(trimmed);
  }

  if (!messages1.length || !messages2.length) {
    return { messages1: defaultMessages1, messages2: defaultMessages2 };
  }

  return { messages1, messages2 };
}

function defaults() {
  return {
    account1: { label: "Akun 1", phone: "" },
    account2: { label: "Akun 2", phone: "" },
    intervalMinSec: 10,
    intervalMaxSec: 20,
  };
}

function sanitizeConfig(input = {}) {
  const base = defaults();
  const lines = (value, fallback) => Array.isArray(value)
    ? value.map((x) => String(x).trim()).filter(Boolean).slice(0, 200)
    : fallback;
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
    req.on("data", (chunk) => raw += chunk);
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("JSON tidak valid.")); }
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
  const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
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

function runtime(userId) {
  if (!RUNTIME.has(userId)) {
    RUNTIME.set(userId, {
      logs: [],
      bot: { running: false, stop: false, promise: null },
      accounts: {
        account1: blankAccount(),
        account2: blankAccount(),
      },
    });
  }
  return RUNTIME.get(userId);
}

function blankAccount() {
  return { client: null, phone: null, status: "idle", method: null, qrDataUrl: null, pairingCode: null, lastError: null };
}

function getSessionDir(userId, key, phone) {
  if (!phone) return null;
  return path.join(AUTH_DIR, userId, `session-${key}_${formatNumber(phone)}`);
}

function removeSessionDir(userId, key, phone) {
  const sessionDir = getSessionDir(userId, key, phone);
  if (sessionDir && fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

function log(userId, message) {
  const rt = runtime(userId);
  rt.logs.unshift(`[${new Date().toLocaleString("id-ID")}] ${message}`);
  rt.logs = rt.logs.slice(0, 100);
}

function accountState(acc) {
  return {
    status: acc.status,
    method: acc.method,
    qrDataUrl: acc.qrDataUrl,
    pairingCode: acc.pairingCode,
    lastError: acc.lastError,
    phone: acc.phone,
  };
}

function dashboard(user) {
  const rt = runtime(user.id);
  return {
    user: userPublic(user),
    accounts: {
      account1: accountState(rt.accounts.account1),
      account2: accountState(rt.accounts.account2),
    },
    bot: { running: rt.bot.running },
    logs: rt.logs,
  };
}

async function disconnectAccount(userId, key) {
  const rt = runtime(userId);
  const current = rt.accounts[key];
  const currentPhone = current.phone;
  if (current.client) {
    try { await current.client.destroy(); } catch {}
  }
  removeSessionDir(userId, key, currentPhone);
  rt.accounts[key] = blankAccount();
}

function makeClient(userId, key, phone) {
  const dir = path.join(AUTH_DIR, userId);
  ensureDir(dir);
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  const puppeteer = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  };
  if (executablePath) {
    puppeteer.executablePath = executablePath;
  }
  return new Client({
    authStrategy: new LocalAuth({ clientId: `${key}_${formatNumber(phone)}`, dataPath: dir }),
    puppeteer,
  });
}

async function connectAccount(user, key, method) {
  const cfg = user.config[key];
  const rt = runtime(user.id);
  const phone = formatNumber(cfg.phone);
  if (!phone) throw new Error(`Nomor ${cfg.label} belum diisi.`);

  const current = rt.accounts[key];
  const reusableStatuses = new Set(["awaiting_scan", "authenticated", "ready"]);
  if (current.client) {
    const samePhone = current.phone === phone;
    const reusable = samePhone && reusableStatuses.has(current.status);
    if (!reusable) {
      log(user.id, `${cfg.label} reset client lama sebelum connect baru.`);
      await disconnectAccount(user.id, key);
    } else {
      log(user.id, `${cfg.label} masih aktif, lanjut pakai sesi connect yang ada.`);
      return;
    }
  }

  const client = makeClient(user.id, key, phone);
  rt.accounts[key] = { client, phone, status: "initializing", method, qrDataUrl: null, pairingCode: null, lastError: null };
  log(user.id, `${cfg.label} mulai connect (${method}).`);

  client.on("qr", async (qr) => {
    const acc = runtime(user.id).accounts[key];
    acc.status = "awaiting_scan";
    acc.method = method;
    if (method === "pairing") {
      try {
        acc.pairingCode = await client.requestPairingCode(phone);
        acc.qrDataUrl = null;
        acc.lastError = null;
      } catch (e) {
        acc.lastError = `Pairing code gagal, pakai QR fallback: ${e.message}`;
        try { acc.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 }); } catch (qrErr) { acc.lastError = qrErr.message; }
      }
    } else {
      try {
        acc.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
        acc.pairingCode = null;
      } catch (e) {
        acc.lastError = e.message;
      }
    }
  });
  client.on("authenticated", () => { runtime(user.id).accounts[key].status = "authenticated"; log(user.id, `${cfg.label} authenticated.`); });
  client.on("ready", () => { const acc = runtime(user.id).accounts[key]; acc.status = "ready"; acc.qrDataUrl = null; acc.lastError = null; log(user.id, `${cfg.label} ready.`); });
  client.on("auth_failure", (msg) => { const acc = runtime(user.id).accounts[key]; acc.status = "auth_failure"; acc.lastError = msg; log(user.id, `${cfg.label} auth gagal: ${msg}`); });
  client.on("disconnected", (reason) => { const acc = runtime(user.id).accounts[key]; acc.status = "disconnected"; acc.lastError = reason; acc.client = null; log(user.id, `${cfg.label} terputus: ${reason}`); });
  client.initialize().catch((e) => { const acc = runtime(user.id).accounts[key]; acc.status = "error"; acc.lastError = e.message; acc.client = null; log(user.id, `${cfg.label} gagal connect: ${e.message}`); });
}

async function sendFrom(user, key, targetPhone, messages) {
  const sender = runtime(user.id).accounts[key];
  if (!sender.client || sender.status !== "ready") throw new Error(`${user.config[key].label} belum ready.`);
  const msg = messages[Math.floor(Math.random() * messages.length)];
  const targetChatId = chatId(targetPhone);
  log(user.id, `${user.config[key].label} mencoba kirim ke ${targetPhone}...`);
  const numberInfo = await withTimeout(
    sender.client.getNumberId(targetPhone),
    10000,
    `Cek nomor ${user.config[key].label}`
  );
  if (!numberInfo?._serialized) {
    throw new Error(`${user.config[key].label} tidak menemukan akun WhatsApp tujuan ${targetPhone}.`);
  }

  log(user.id, `${user.config[key].label} menemukan chat ${numberInfo._serialized}.`);
  const chat = await withTimeout(
    sender.client.getChatById(numberInfo._serialized),
    10000,
    `Buka chat ${user.config[key].label}`
  );
  if (!chat) {
    throw new Error(`${user.config[key].label} gagal membuka chat tujuan ${targetPhone}.`);
  }

  await withTimeout(chat.sendMessage(msg), 20000, `Kirim ${user.config[key].label}`);
  log(user.id, `${user.config[key].label} -> ${targetPhone}: ${msg}`);
}

async function startBot(user) {
  const rt = runtime(user.id);
  if (rt.bot.running) throw new Error("Bot sudah jalan.");
  const { account1, account2, intervalMinSec, intervalMaxSec } = user.config;
  const { messages1, messages2 } = readMessagesFromFile(MESSAGES_FILE);
  if (!account1.phone || !account2.phone) throw new Error("Isi dua nomor akun dulu.");
  if (formatNumber(account1.phone) === formatNumber(account2.phone)) throw new Error("Nomor akun harus berbeda.");
  if (!messages1.length || !messages2.length) throw new Error("Pesan kedua akun tidak boleh kosong.");
  if (rt.accounts.account1.status !== "ready" || rt.accounts.account2.status !== "ready") throw new Error("Kedua akun harus ready.");

  rt.bot.running = true;
  rt.bot.stop = false;
  log(user.id, "Bot dimulai.");
  rt.bot.promise = (async () => {
    let turn = "account1";
    while (!rt.bot.stop) {
      if (turn === "account1") {
        await sendFrom(user, "account1", account2.phone, messages1).catch((e) => log(user.id, e.message));
        turn = "account2";
      } else {
        await sendFrom(user, "account2", account1.phone, messages2).catch((e) => log(user.id, e.message));
        turn = "account1";
      }
      const min = Math.min(intervalMinSec, intervalMaxSec) * 1000;
      const max = Math.max(intervalMinSec, intervalMaxSec) * 1000;
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      log(user.id, `Jeda ${Math.round(delay / 1000)} detik.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  })().finally(() => {
    rt.bot.running = false;
    rt.bot.stop = false;
    rt.bot.promise = null;
    log(user.id, "Bot berhenti.");
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
      const body = await parse(req);
      const db = readUsers();
      const username = String(body.username || "").trim().toLowerCase();
      if (!username || !body.password) throw new Error("Username dan password wajib diisi.");
      if (db.users.some((u) => u.username === username)) throw new Error("Username sudah dipakai.");
      const pass = hashPassword(String(body.password));
      const user = { id: uid("user"), username, passwordSalt: pass.salt, passwordHash: pass.hash, config: defaults() };
      db.users.push(user);
      saveUsers(db);
      return json(res, 201, { user: userPublic(user) });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    try {
      const body = await parse(req);
      const user = getUserByName(body.username);
      if (!user || !verifyPassword(String(body.password || ""), user)) return json(res, 401, { error: "Username atau password salah." });
      const token = uid("token");
      TOKENS.set(token, { userId: user.id });
      return json(res, 200, { token, user: userPublic(user) });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = req.headers["x-auth-token"];
    if (token) TOKENS.delete(token);
    return json(res, 200, { ok: true });
  }

  const user = auth(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/dashboard") return json(res, 200, dashboard(user));

  if (req.method === "POST" && url.pathname === "/api/config") {
    try {
      const body = await parse(req);
      const updated = updateUser(user.id, (current) => ({ ...current, config: sanitizeConfig(body) }));
      log(user.id, "Konfigurasi disimpan.");
      return json(res, 200, dashboard(updated));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/connect") {
    try {
      const body = await parse(req);
      if (!["account1", "account2"].includes(body.accountKey)) throw new Error("accountKey tidak valid.");
      const fresh = getUserById(user.id);
      await connectAccount(fresh, body.accountKey, body.method === "qr" ? "qr" : "pairing");
      return json(res, 200, dashboard(fresh));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/disconnect") {
    try {
      const body = await parse(req);
      if (!["account1", "account2"].includes(body.accountKey)) throw new Error("accountKey tidak valid.");
      await disconnectAccount(user.id, body.accountKey);
      log(user.id, `${body.accountKey} diputus.`);
      return json(res, 200, dashboard(getUserById(user.id)));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bot/start") {
    try {
      const fresh = getUserById(user.id);
      await startBot(fresh);
      return json(res, 200, dashboard(fresh));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bot/stop") {
    runtime(user.id).bot.stop = true;
    log(user.id, "Permintaan stop diterima.");
    return json(res, 200, dashboard(getUserById(user.id)));
  }

  return json(res, 404, { error: "Endpoint tidak ditemukan." });
});

server.listen(PORT, HOST, () => {
  console.log(`Multi-user web aktif di http://localhost:${PORT}`);
});
