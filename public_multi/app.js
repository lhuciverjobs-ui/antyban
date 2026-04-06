const state = {
  token: localStorage.getItem("wa_multi_token") || "",
  configEditingUntil: 0,
  qrModalAccountKey: null,
  pairingAccountKey: null,
  fastRefreshUntil: 0,
  dashboardStream: null,
  streamRetryTimer: null,
  currentConfig: null,
};
const authCard = document.getElementById("authCard");
const appCard = document.getElementById("appCard");
const toast = document.getElementById("toast");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const qrModal = document.getElementById("qrModal");
const qrModalKicker = document.getElementById("qrModalKicker");
const qrModalTitle = document.getElementById("qrModalTitle");
const qrModalText = document.getElementById("qrModalText");
const qrModalCode = document.getElementById("qrModalCode");
const qrModalImage = document.getElementById("qrModalImage");
const pairingModal = document.getElementById("pairingModal");
const pairingModalTitle = document.getElementById("pairingModalTitle");
const pairingPhoneInput = document.getElementById("pairingPhoneInput");
const pairingForm = document.getElementById("pairingForm");
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const panelViews = Array.from(document.querySelectorAll(".panel-view"));

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

function activatePanel(panelName) {
  navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.panel === panelName);
  });

  panelViews.forEach((view) => {
    view.classList.toggle("is-visible", view.dataset.view === panelName);
  });
}

function closeDashboardStream() {
  if (state.streamRetryTimer) {
    clearTimeout(state.streamRetryTimer);
    state.streamRetryTimer = null;
  }
  if (state.dashboardStream) {
    state.dashboardStream.close();
    state.dashboardStream = null;
  }
}

function scheduleFallbackRefresh(delay = 4000) {
  if (state.streamRetryTimer || !state.token) return;
  state.streamRetryTimer = setTimeout(async () => {
    state.streamRetryTimer = null;
    await refresh(true);
    openDashboardStream();
  }, delay);
}

function openDashboardStream() {
  if (!state.token || state.dashboardStream) return;
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  state.dashboardStream = stream;

  stream.addEventListener("dashboard", (event) => {
    try {
      render(JSON.parse(event.data));
    } catch {}
  });

  stream.onerror = async () => {
    closeDashboardStream();
    scheduleFallbackRefresh(state.fastRefreshUntil > Date.now() ? 1200 : 5000);
  };
}

function logoutLocal() {
  closeDashboardStream();
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

function openPairingModal(accountKey) {
  state.pairingAccountKey = accountKey;
  pairingModalTitle.textContent = accountKey === "account1" ? "Masukkan nomor untuk Akun 1" : "Masukkan nomor untuk Akun 2";
  pairingPhoneInput.value = state.currentConfig?.[accountKey]?.phone || "";
  pairingModal.classList.remove("hidden");
  pairingModal.setAttribute("aria-hidden", "false");
  setTimeout(() => pairingPhoneInput.focus(), 0);
}

function closePairingModal() {
  state.pairingAccountKey = null;
  pairingModal.classList.add("hidden");
  pairingModal.setAttribute("aria-hidden", "true");
  pairingForm.reset();
}

function openQrModal(accountKey) {
  state.qrModalAccountKey = accountKey;
  qrModalKicker.textContent = "QR Connect";
  qrModalTitle.textContent = accountKey === "account1" ? "Scan QR Akun 1" : "Scan QR Akun 2";
  qrModalText.textContent = "Menunggu QR muncul...";
  qrModalCode.textContent = "";
  qrModalCode.classList.add("hidden");
  qrModalImage.classList.add("hidden");
  qrModalImage.removeAttribute("src");
  qrModal.classList.remove("hidden");
  qrModal.setAttribute("aria-hidden", "false");
}

function closeQrModal() {
  state.qrModalAccountKey = null;
  qrModal.classList.add("hidden");
  qrModal.setAttribute("aria-hidden", "true");
  qrModalCode.textContent = "";
  qrModalCode.classList.add("hidden");
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
  state.currentConfig = {
    account1: { label: config.account1.label || "Akun 1", phone: config.account1.phone || "" },
    account2: { label: config.account2.label || "Akun 2", phone: config.account2.phone || "" },
    intervalMinSec: config.intervalMinSec ?? 10,
    intervalMaxSec: config.intervalMaxSec ?? 20,
  };

  if (!isEditing) {
    form.intervalMinSec.value = state.currentConfig.intervalMinSec;
    form.intervalMaxSec.value = state.currentConfig.intervalMaxSec;
  }

  document.getElementById("accountName1").textContent = state.currentConfig.account1.label || "Akun 1";
  document.getElementById("accountName2").textContent = state.currentConfig.account2.label || "Akun 2";
}

function markConfigEditing() {
  state.configEditingUntil = Date.now() + 15000;
}

function renderAccount(key, data) {
  const suffix = key === "account1" ? "1" : "2";
  const badge = document.getElementById(`badge${suffix}`);
  badge.textContent = data.status;
  badge.className = `status-chip ${data.status === "ready" ? "on" : "off"}`;
  document.getElementById(`pairing${suffix}`).textContent = data.pairingCode || "-";
  document.getElementById(`error${suffix}`).textContent = data.lastError || "";
  const phoneText = String(data.phone || "").trim();
  const phoneRow = document.getElementById(`accountPhoneRow${suffix}`);
  const phoneValue = document.getElementById(`accountPhone${suffix}`);
  phoneValue.textContent = phoneText;
  phoneRow.classList.toggle("hidden", !phoneText);

  if (state.qrModalAccountKey === key) {
    if (data.status === "ready") {
      closeQrModal();
      activatePanel("account");
      notify(`${key} berhasil terhubung.`);
    } else if (data.pairingCode) {
      qrModalKicker.textContent = "Pairing Code";
      qrModalTitle.textContent = key === "account1" ? "Code Akun 1" : "Code Akun 2";
      qrModalText.textContent = "Masukkan pairing code ini di WhatsApp.";
      qrModalCode.textContent = data.pairingCode;
      qrModalCode.classList.remove("hidden");
      qrModalImage.classList.add("hidden");
      qrModalImage.removeAttribute("src");
    } else if (data.method === "pairing" && data.qrDataUrl) {
      qrModalKicker.textContent = "QR Fallback";
      qrModalTitle.textContent = key === "account1" ? "Scan QR Akun 1" : "Scan QR Akun 2";
      qrModalText.textContent = "Pairing code gagal dibuat, jadi sistem menampilkan QR sebagai fallback.";
      qrModalCode.textContent = "";
      qrModalCode.classList.add("hidden");
      qrModalImage.src = data.qrDataUrl;
      qrModalImage.classList.remove("hidden");
    } else if (data.qrDataUrl) {
      qrModalKicker.textContent = "QR Connect";
      qrModalTitle.textContent = key === "account1" ? "Scan QR Akun 1" : "Scan QR Akun 2";
      qrModalText.textContent = "Scan QR ini dengan WhatsApp pada akun yang dipilih.";
      qrModalCode.textContent = "";
      qrModalCode.classList.add("hidden");
      qrModalImage.src = data.qrDataUrl;
      qrModalImage.classList.remove("hidden");
    } else if (data.lastError) {
      qrModalCode.textContent = "";
      qrModalCode.classList.add("hidden");
      qrModalText.textContent = data.lastError;
      qrModalImage.classList.add("hidden");
      qrModalImage.removeAttribute("src");
    } else {
      qrModalKicker.textContent = "QR Connect";
      qrModalTitle.textContent = key === "account1" ? "Scan QR Akun 1" : "Scan QR Akun 2";
      qrModalText.textContent = "Menunggu QR muncul...";
      qrModalCode.textContent = "";
      qrModalCode.classList.add("hidden");
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
    const payload = await api("/api/dashboard", { method: "GET" });
    render(payload);
    openDashboardStream();
  } catch (error) {
    if (!silent) notify(error.message, true);
    logoutLocal();
  }
}

async function saveConfigPatch(patch) {
  const nextConfig = {
    account1: { ...(state.currentConfig?.account1 || { label: "Akun 1", phone: "" }) },
    account2: { ...(state.currentConfig?.account2 || { label: "Akun 2", phone: "" }) },
    intervalMinSec: state.currentConfig?.intervalMinSec ?? 10,
    intervalMaxSec: state.currentConfig?.intervalMaxSec ?? 20,
    ...patch,
  };

  const payload = await api("/api/config", { method: "POST", body: JSON.stringify(nextConfig) });
  render(payload);
  return payload;
}

async function connectAccount(accountKey, method) {
  activatePanel("account");
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
    openDashboardStream();
    activatePanel("account");
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
  try {
    await saveConfigPatch({
      intervalMinSec: Number(form.get("intervalMinSec")),
      intervalMaxSec: Number(form.get("intervalMaxSec")),
    });
    notify("Timing disimpan.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.querySelectorAll("[data-connect]").forEach((button) => {
  button.addEventListener("click", async () => {
    const accountKey = button.dataset.connect;
    const method = button.dataset.method;
    try {
      if (method === "pairing") {
        openPairingModal(accountKey);
        return;
      }
      await connectAccount(accountKey, method);
    } catch (error) {
      closeQrModal();
      notify(error.message, true);
    }
  });
});

pairingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.pairingAccountKey) return;
  const accountKey = state.pairingAccountKey;
  const phone = pairingPhoneInput.value.trim();
  if (!phone) {
    notify("Nomor WhatsApp wajib diisi.", true);
    return;
  }

  try {
    const nextAccountConfig = {
      ...(state.currentConfig?.[accountKey] || { label: accountKey === "account1" ? "Akun 1" : "Akun 2", phone: "" }),
      phone,
    };

    await saveConfigPatch({ [accountKey]: nextAccountConfig });
    closePairingModal();
    await connectAccount(accountKey, "pairing");
  } catch (error) {
    notify(error.message, true);
  }
});

document.querySelectorAll("[data-disconnect]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      activatePanel("account");
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
    activatePanel("console");
    notify("Bot dijalankan.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.getElementById("stopBotBtn").addEventListener("click", async () => {
  try {
    render(await api("/api/bot/stop", { method: "POST" }));
    activatePanel("console");
    notify("Bot dihentikan.");
  } catch (error) {
    notify(error.message, true);
  }
});

document.getElementById("refreshBtn").addEventListener("click", () => refresh());
document.getElementById("closeQrModalBtn").addEventListener("click", closeQrModal);
document.getElementById("closePairingModalBtn").addEventListener("click", closePairingModal);
document.querySelectorAll("[data-close-modal='true']").forEach((el) => el.addEventListener("click", closeQrModal));
document.querySelectorAll("[data-close-pairing='true']").forEach((el) => el.addEventListener("click", closePairingModal));

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

navItems.forEach((item) => {
  item.addEventListener("click", () => activatePanel(item.dataset.panel));
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.token) {
    refresh(true);
  }
});

setInterval(() => {
  if (!state.token || document.hidden) return;
  if (!state.dashboardStream) {
    refresh(true);
    return;
  }
  if (Date.now() < state.fastRefreshUntil) {
    refresh(true);
  }
}, 15000);

activatePanel("account");
refresh(true);


