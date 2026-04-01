const state = {
  token: localStorage.getItem("wa_multi_token") || "",
  configEditingUntil: 0,
  qrModalAccountKey: null,
  fastRefreshUntil: 0,
};
const authCard = document.getElementById("authCard");
const appCard = document.getElementById("appCard");
const toast = document.getElementById("toast");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const qrModal = document.getElementById("qrModal");
const qrModalTitle = document.getElementById("qrModalTitle");
const qrModalText = document.getElementById("qrModalText");
const qrModalImage = document.getElementById("qrModalImage");

function notify(message, error = false) {
  toast.textContent = message;
  toast.className = `toast ${error ? "error" : ""}`;
  setTimeout(() => toast.className = "toast hidden", 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { "x-auth-token": state.token } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request gagal.");
  return data;
}

function logoutLocal() {
  state.token = "";
  localStorage.removeItem("wa_multi_token");
  appCard.classList.add("hidden");
  authCard.classList.remove("hidden");
  document.body.classList.remove("dashboard-body");
  showAuthTab("login");
}

function showAuthTab(mode) {
  const loginMode = mode === "login";
  loginForm.classList.toggle("hidden", !loginMode);
  registerForm.classList.toggle("hidden", loginMode);
  loginTab.classList.toggle("active", loginMode);
  registerTab.classList.toggle("active", !loginMode);
}

function wirePasswordToggle(buttonId, inputId) {
  const button = document.getElementById(buttonId);
  const input = document.getElementById(inputId);
  button.addEventListener("click", () => {
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "Hide" : "Show";
  });
}

function openQrModal(accountKey) {
  state.qrModalAccountKey = accountKey;
  qrModalTitle.textContent = accountKey === "account1" ? "Scan QR Akun 1" : "Scan QR Akun 2";
  qrModalText.textContent = "Menunggu QR muncul...";
  qrModalImage.classList.add("hidden");
  qrModalImage.removeAttribute("src");
  qrModal.classList.remove("hidden");
  qrModal.setAttribute("aria-hidden", "false");
}

function closeQrModal() {
  state.qrModalAccountKey = null;
  qrModal.classList.add("hidden");
  qrModal.setAttribute("aria-hidden", "true");
  qrModalImage.classList.add("hidden");
  qrModalImage.removeAttribute("src");
}

function startFastRefresh(ms = 12000) {
  state.fastRefreshUntil = Date.now() + ms;
}

function fillConfig(config) {
  const form = document.getElementById("configForm");
  const active = document.activeElement;
  const isEditing = Date.now() < state.configEditingUntil || form.contains(active);
  if (isEditing) return;

  form.account1Label.value = config.account1.label || "";
  form.account1Phone.value = config.account1.phone || "";
  form.account2Label.value = config.account2.label || "";
  form.account2Phone.value = config.account2.phone || "";
  form.intervalMinSec.value = config.intervalMinSec ?? 10;
  form.intervalMaxSec.value = config.intervalMaxSec ?? 20;
}

function markConfigEditing() {
  state.configEditingUntil = Date.now() + 15000;
}

function renderAccount(key, data) {
  const suffix = key === "account1" ? "1" : "2";
  document.getElementById(`status${suffix}`).textContent = data.status;
  const badge = document.getElementById(`badge${suffix}`);
  badge.textContent = data.status;
  badge.className = `status-chip ${data.status === "ready" ? "on" : "off"}`;
  document.getElementById(`pairing${suffix}`).textContent = data.pairingCode ? `Pairing code: ${data.pairingCode}` : "";
  document.getElementById(`error${suffix}`).textContent = data.lastError || "";
  if (state.qrModalAccountKey === key) {
    if (data.status === "ready") {
      closeQrModal();
      notify(`${key} berhasil terhubung.`);
    } else if (data.pairingCode) {
      qrModalText.textContent = `Masukkan pairing code ini di WhatsApp: ${data.pairingCode}`;
      qrModalImage.classList.add("hidden");
      qrModalImage.removeAttribute("src");
    } else if (data.method === "pairing" && data.qrDataUrl) {
      qrModalText.textContent = "Pairing code gagal dibuat, jadi sistem menampilkan QR sebagai fallback.";
      qrModalImage.src = data.qrDataUrl;
      qrModalImage.classList.remove("hidden");
    } else if (data.qrDataUrl) {
      qrModalText.textContent = "Scan QR ini dengan WhatsApp pada akun yang dipilih.";
      qrModalImage.src = data.qrDataUrl;
      qrModalImage.classList.remove("hidden");
    } else if (data.lastError) {
      qrModalText.textContent = data.lastError;
      qrModalImage.classList.add("hidden");
      qrModalImage.removeAttribute("src");
    } else {
      qrModalText.textContent = "Menunggu QR muncul...";
      qrModalImage.classList.add("hidden");
      qrModalImage.removeAttribute("src");
    }
  }
}

function render(payload) {
  authCard.classList.add("hidden");
  appCard.classList.remove("hidden");
  document.body.classList.add("dashboard-body");
  document.getElementById("welcomeText").textContent = payload.user.username;
  const startBotBtn = document.getElementById("startBotBtn");
  const stopBotBtn = document.getElementById("stopBotBtn");
  const botText = payload.bot.running ? "jalan" : "mati";
  document.getElementById("botStatus").textContent = botText;
  document.getElementById("botStatusBadge").textContent = payload.bot.running ? "bot online" : "bot offline";
  document.getElementById("botStatusBadge").className = `status-chip ${payload.bot.running ? "on" : "off"}`;
  document.getElementById("botStatusMini").textContent = payload.bot.running ? "bot online" : "live feed";
  startBotBtn.disabled = payload.bot.running;
  stopBotBtn.disabled = !payload.bot.running;
  startBotBtn.classList.toggle("is-disabled", payload.bot.running);
  stopBotBtn.classList.toggle("is-disabled", !payload.bot.running);
  document.getElementById("logBox").textContent = (payload.logs || []).join("\n") || "Belum ada log.";
  fillConfig(payload.user.config);
  renderAccount("account1", payload.accounts.account1);
  renderAccount("account2", payload.accounts.account2);
}

async function refresh(silent = false) {
  if (!state.token) return;
  try {
    render(await api("/api/dashboard", { method: "GET" }));
  } catch (error) {
    if (!silent) notify(error.message, true);
    logoutLocal();
  }
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form = new FormData(formEl);
  try {
    await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    notify("User berhasil dibuat.");
    formEl.reset();
    showAuthTab("login");
  } catch (error) {
    notify(error.message, true);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form = new FormData(formEl);
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    state.token = data.token;
    localStorage.setItem("wa_multi_token", data.token);
    await refresh(true);
    notify("Login berhasil.");
    formEl.reset();
  } catch (error) {
    notify(error.message, true);
  }
});

document.getElementById("configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.configEditingUntil = 0;
  const form = new FormData(event.currentTarget);
  const body = {
    account1: { label: form.get("account1Label"), phone: form.get("account1Phone") },
    account2: { label: form.get("account2Label"), phone: form.get("account2Phone") },
    intervalMinSec: Number(form.get("intervalMinSec")),
    intervalMaxSec: Number(form.get("intervalMaxSec")),
  };
  try {
    render(await api("/api/config", { method: "POST", body: JSON.stringify(body) }));
    notify("Konfigurasi disimpan.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.querySelectorAll("[data-connect]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const accountKey = button.dataset.connect;
      const method = button.dataset.method;
      if (method === "qr" || method === "pairing") {
        openQrModal(accountKey);
        startFastRefresh();
        qrModalText.textContent = method === "pairing"
          ? "Menunggu pairing code muncul..."
          : "Menunggu QR muncul...";
      }
      render(await api("/api/connect", {
        method: "POST",
        body: JSON.stringify({ accountKey, method }),
      }));
      notify(`Proses ${accountKey} dimulai.`);
    } catch (error) {
      closeQrModal();
      notify(error.message, true);
    }
  });
});

document.querySelectorAll("[data-disconnect]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      if (state.qrModalAccountKey === button.dataset.disconnect) {
        closeQrModal();
      }
      render(await api("/api/disconnect", {
        method: "POST",
        body: JSON.stringify({ accountKey: button.dataset.disconnect }),
      }));
      notify(`${button.dataset.disconnect} diputus.`);
    } catch (error) {
      notify(error.message, true);
    }
  });
});

document.getElementById("startBotBtn").addEventListener("click", async () => {
  try {
    render(await api("/api/bot/start", { method: "POST" }));
    notify("Bot dijalankan.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.getElementById("stopBotBtn").addEventListener("click", async () => {
  try {
    render(await api("/api/bot/stop", { method: "POST" }));
    notify("Bot dihentikan.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.getElementById("refreshBtn").addEventListener("click", () => refresh());
document.getElementById("closeQrModalBtn").addEventListener("click", closeQrModal);
document.querySelectorAll("[data-close-modal='true']").forEach((el) => el.addEventListener("click", closeQrModal));

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  logoutLocal();
  notify("Logout berhasil.");
});

loginTab.addEventListener("click", () => showAuthTab("login"));
registerTab.addEventListener("click", () => showAuthTab("register"));
wirePasswordToggle("toggleLoginPassword", "loginPassword");
wirePasswordToggle("toggleRegisterPassword", "registerPassword");
document.getElementById("configForm").addEventListener("input", markConfigEditing);
document.getElementById("configForm").addEventListener("focusin", markConfigEditing);

setInterval(() => refresh(true), 1200);
setInterval(() => {
  if (Date.now() < state.fastRefreshUntil) {
    refresh(true);
  }
}, 350);
refresh(true);
