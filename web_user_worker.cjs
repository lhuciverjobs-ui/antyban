const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const ROOT = process.env.WORKER_ROOT || __dirname;
const AUTH_DIR = process.env.WORKER_AUTH_DIR || path.join(ROOT, ".wwebjs_multi_auth");
const MESSAGES_FILE = process.env.WORKER_MESSAGES_FILE || path.join(ROOT, "pesan.txt");

let currentUser = null;
let runtime = blankRuntime();

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "init") {
    currentUser = message.user;
    publishSnapshot();
    return;
  }

  if (message.type !== "command") return;

  if (message.user) currentUser = message.user;

  try {
    switch (message.command) {
      case "update_config":
        currentUser = { ...currentUser, config: message.payload.config };
        log("Konfigurasi worker diperbarui.");
        return respond(message.requestId, true);
      case "connect":
        await connectAccount(message.payload.accountKey, message.payload.method);
        return respond(message.requestId, true);
      case "disconnect":
        await disconnectAccount(message.payload.accountKey);
        log(`${message.payload.accountKey} diputus.`);
        return respond(message.requestId, true);
      case "bot_start":
        await startBot();
        return respond(message.requestId, true);
      case "bot_stop":
        runtime.bot.stop = true;
        log("Permintaan stop diterima.");
        publishSnapshot();
        return respond(message.requestId, true);
      default:
        throw new Error("Perintah worker tidak dikenal.");
    }
  } catch (error) {
    return respond(message.requestId, false, error.message || String(error));
  }
});

function blankAccount() {
  return {
    client: null,
    phone: null,
    status: "idle",
    method: null,
    preferredMethod: "pairing",
    qrDataUrl: null,
    pairingCode: null,
    lastError: null,
    reconnectTimer: null,
    manualDisconnect: false,
    reconnectAttempts: 0,
  };
}

function blankRuntime() {
  return {
    logs: [],
    bot: { running: false, stop: false, promise: null },
    accounts: {
      account1: blankAccount(),
      account2: blankAccount(),
    },
  };
}

function accountState(acc) {
  return {
    status: acc.status,
    method: acc.method,
    preferredMethod: acc.preferredMethod,
    qrDataUrl: acc.qrDataUrl,
    pairingCode: acc.pairingCode,
    lastError: acc.lastError,
    phone: acc.phone,
  };
}

function snapshot() {
  return {
    accounts: {
      account1: accountState(runtime.accounts.account1),
      account2: accountState(runtime.accounts.account2),
    },
    bot: { running: runtime.bot.running },
    logs: runtime.logs,
    worker: { online: true, pid: process.pid, lastError: null },
  };
}

function publishSnapshot() {
  process.send?.({ type: "snapshot", snapshot: snapshot() });
}

function respond(requestId, ok, error = null) {
  process.send?.({
    type: "response",
    requestId,
    ok,
    error,
    snapshot: snapshot(),
  });
}

function log(message) {
  runtime.logs.unshift(`[${new Date().toLocaleString("id-ID")}] ${message}`);
  runtime.logs = runtime.logs.slice(0, 100);
  publishSnapshot();
}

function formatNumber(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

function chatId(phone) {
  return `${formatNumber(phone)}@c.us`;
}

function sessionId(phone) {
  return `sesi_${formatNumber(phone)}`;
}

function getSessionDir(userId, phone) {
  if (!phone) return null;
  return path.join(AUTH_DIR, userId, `session-${sessionId(phone)}`);
}

function removeSessionDir(userId, phone) {
  const sessionDir = getSessionDir(userId, phone);
  if (sessionDir && fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return true;
  }
  return false;
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

function makeClient(phone, method = null) {
  const dir = path.join(AUTH_DIR, currentUser.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  const puppeteer = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  };
  if (executablePath) puppeteer.executablePath = executablePath;

  const clientOptions = {
    authStrategy: new LocalAuth({ clientId: sessionId(phone), dataPath: dir }),
    puppeteer,
  };

  if (method === "pairing") {
    clientOptions.pairWithPhoneNumber = {
      phoneNumber: phone,
      showNotification: true,
      intervalMs: 180000,
    };
  }

  return new Client(clientOptions);
}

async function verifyStoredSession(phone) {
  const sessionDir = getSessionDir(currentUser.id, phone);
  if (!sessionDir || !fs.existsSync(sessionDir)) {
    return { status: "missing", detail: "folder sesi tidak ditemukan" };
  }

  const client = makeClient(phone, null);

  try {
    return await new Promise((resolve) => {
      let settled = false;
      let timeout = null;

      const finish = async (result) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        try { await client.destroy(); } catch {}
        resolve(result);
      };

      timeout = setTimeout(() => finish({ status: "inactive", detail: "timeout saat verifikasi sesi" }), 45000);
      client.on("ready", () => finish({ status: "active", detail: "sesi masih valid" }));
      client.on("qr", () => finish({ status: "inactive", detail: "perlu login ulang" }));
      client.on("auth_failure", (msg) => finish({ status: "inactive", detail: msg || "auth gagal" }));
      client.on("disconnected", (reason) => finish({ status: "inactive", detail: reason || "terputus" }));
      client.initialize().catch((error) => finish({ status: "inactive", detail: error.message || String(error) }));
    });
  } catch (error) {
    try { await client.destroy(); } catch {}
    return { status: "inactive", detail: error.message || String(error) };
  }
}

async function disconnectAccount(key) {
  const current = runtime.accounts[key];
  current.manualDisconnect = true;
  if (current.reconnectTimer) {
    clearTimeout(current.reconnectTimer);
    current.reconnectTimer = null;
  }
  const currentPhone = current.phone;
  if (current.client) {
    try { await current.client.destroy(); } catch {}
  }
  removeSessionDir(currentUser.id, currentPhone);
  runtime.accounts[key] = blankAccount();
  publishSnapshot();
}

function scheduleReconnect(key, method) {
  const acc = runtime.accounts[key];
  if (acc.manualDisconnect) return;
  if (acc.reconnectTimer) clearTimeout(acc.reconnectTimer);

  const nextMethod = method || acc.preferredMethod || "pairing";
  const delay = Math.min(15000, 3000 + (acc.reconnectAttempts || 0) * 2000);
  acc.reconnectAttempts = (acc.reconnectAttempts || 0) + 1;
  acc.status = "reconnecting";
  acc.lastError = `Mencoba reconnect otomatis dalam ${Math.round(delay / 1000)} detik...`;
  publishSnapshot();

  acc.reconnectTimer = setTimeout(async () => {
    acc.reconnectTimer = null;
    try {
      log(`${currentUser.config[key].label} auto reconnect (${nextMethod}).`);
      await connectAccount(key, nextMethod);
    } catch (error) {
      const latest = runtime.accounts[key];
      latest.lastError = error.message;
      publishSnapshot();
      scheduleReconnect(key, nextMethod);
    }
  }, delay);
}

async function connectAccount(key, method) {
  if (!currentUser) throw new Error("Worker belum siap.");
  const cfg = currentUser.config[key];
  const phone = formatNumber(cfg.phone);
  if (!phone) throw new Error(`Nomor ${cfg.label} belum diisi.`);

  const current = runtime.accounts[key];
  if (current.client) {
    const samePhone = current.phone === phone;
    const reusable = samePhone && current.status === "ready";
    if (reusable) {
      log(`${cfg.label} masih aktif, lanjut pakai sesi connect yang ada.`);
      return;
    }

    log(`${cfg.label} reset client lama sebelum connect baru.`);
    await disconnectAccount(key);
  }

  const sessionProbe = await verifyStoredSession(phone);
  const effectiveMethod = sessionProbe.status === "active" ? null : method;

  if (sessionProbe.status === "active") {
    log(`${cfg.label} pakai sesi tersimpan yang masih valid.`);
  } else if (sessionProbe.status === "inactive") {
    removeSessionDir(currentUser.id, phone);
    log(`${cfg.label} sesi lama tidak valid, lanjut login ulang (${method}).`);
  }

  const client = makeClient(phone, effectiveMethod);
  runtime.accounts[key] = {
    client,
    phone,
    status: "initializing",
    method: effectiveMethod,
    preferredMethod: method || current.preferredMethod || "pairing",
    qrDataUrl: null,
    pairingCode: null,
    lastError: effectiveMethod ? null : sessionProbe.detail,
    reconnectTimer: null,
    manualDisconnect: false,
    reconnectAttempts: 0,
  };
  log(`${cfg.label} mulai connect (${effectiveMethod || "restore_session"}).`);

  client.on("code", (code) => {
    const acc = runtime.accounts[key];
    acc.status = "awaiting_scan";
    acc.method = "pairing";
    acc.preferredMethod = "pairing";
    acc.pairingCode = code;
    acc.qrDataUrl = null;
    acc.lastError = null;
    publishSnapshot();
  });

  client.on("qr", async (qr) => {
    const acc = runtime.accounts[key];
    acc.status = "awaiting_scan";
    acc.method = effectiveMethod;
    if (effectiveMethod && effectiveMethod !== "pairing") {
      acc.preferredMethod = effectiveMethod;
      try {
        acc.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
        acc.pairingCode = null;
      } catch (error) {
        acc.lastError = error.message;
      }
    }
    publishSnapshot();
  });

  client.on("authenticated", () => {
    const acc = runtime.accounts[key];
    acc.status = "authenticated";
    log(`${cfg.label} authenticated.`);
  });

  client.on("ready", () => {
    const acc = runtime.accounts[key];
    acc.status = "ready";
    acc.qrDataUrl = null;
    acc.pairingCode = null;
    acc.lastError = null;
    acc.reconnectAttempts = 0;
    log(`${cfg.label} ready.`);
    publishSnapshot();
  });

  client.on("auth_failure", (msg) => {
    const acc = runtime.accounts[key];
    acc.status = "auth_failure";
    acc.lastError = msg;
    log(`${cfg.label} auth gagal: ${msg}`);
  });

  client.on("disconnected", (reason) => {
    const acc = runtime.accounts[key];
    const manual = acc.manualDisconnect;
    acc.status = "disconnected";
    acc.lastError = reason;
    acc.client = null;
    log(`${cfg.label} terputus: ${reason}`);
    publishSnapshot();
    if (!manual) {
      scheduleReconnect(key, acc.preferredMethod || "pairing");
    }
  });

  client.initialize().catch((error) => {
    const acc = runtime.accounts[key];
    acc.status = "error";
    acc.lastError = error.message;
    acc.client = null;
    log(`${cfg.label} gagal connect: ${error.message}`);
    publishSnapshot();
  });
}

async function sendFrom(key, targetPhone, messages) {
  const sender = runtime.accounts[key];
  if (!sender.client || sender.status !== "ready") throw new Error(`${currentUser.config[key].label} belum ready.`);
  const msg = messages[Math.floor(Math.random() * messages.length)];
  const targetChatId = chatId(targetPhone);
  log(`${currentUser.config[key].label} mencoba kirim ke ${targetPhone}...`);
  await withTimeout(sender.client.sendMessage(targetChatId, msg), 20000, `Kirim ${currentUser.config[key].label}`);
  log(`${currentUser.config[key].label} -> ${targetPhone}: ${msg}`);
}

async function startBot() {
  if (runtime.bot.running) throw new Error("Bot sudah jalan.");
  const { account1, account2, intervalMinSec, intervalMaxSec } = currentUser.config;
  const { messages1, messages2 } = readMessagesFromFile(MESSAGES_FILE);
  if (!account1.phone || !account2.phone) throw new Error("Isi dua nomor akun dulu.");
  if (formatNumber(account1.phone) === formatNumber(account2.phone)) throw new Error("Nomor akun harus berbeda.");
  if (!messages1.length || !messages2.length) throw new Error("Pesan kedua akun tidak boleh kosong.");
  if (runtime.accounts.account1.status !== "ready" || runtime.accounts.account2.status !== "ready") {
    throw new Error("Kedua akun harus ready.");
  }

  runtime.bot.running = true;
  runtime.bot.stop = false;
  log("Bot dimulai.");

  runtime.bot.promise = (async () => {
    let turn = "account1";
    while (!runtime.bot.stop) {
      let success = false;
      if (turn === "account1") {
        success = await sendFrom("account1", account2.phone, messages1).then(() => true).catch((error) => {
          log(error.message);
          return false;
        });
        if (success) turn = "account2";
      } else {
        success = await sendFrom("account2", account1.phone, messages2).then(() => true).catch((error) => {
          log(error.message);
          return false;
        });
        if (success) turn = "account1";
      }

      const min = Math.min(intervalMinSec, intervalMaxSec) * 1000;
      const max = Math.max(intervalMinSec, intervalMaxSec) * 1000;
      const delay = success ? Math.floor(Math.random() * (max - min + 1)) + min : 5000;
      log(`Jeda ${Math.round(delay / 1000)} detik.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  })().finally(() => {
    runtime.bot.running = false;
    runtime.bot.stop = false;
    runtime.bot.promise = null;
    log("Bot berhenti.");
    publishSnapshot();
  });
}
