const ADMIN_PIN = "9999";
const OWNER_PIN = "1421";
const WEBHOOK_URL = "PUT_DISCORD_WEBHOOK_URL_HERE";

let state = {
  currentUser: null,
  isAdmin: false,
  isOwner: false,
  storeName: "Shop Clock",
  logo: ""
};

let db;
let logoutTimer = null;

function initDB() {
  return new Promise((res) => {
    const request = indexedDB.open("clockDB", 1);
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      db.createObjectStore("employees", { keyPath: "id" });
      db.createObjectStore("shifts", { keyPath: "shiftId" });
      db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      res();
    };
  });
}

function save(store, data) {
  return new Promise((res) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(data);
    tx.oncomplete = () => res();
  });
}

function del(store, key) {
  return new Promise((res) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
  });
}

function get(store, key) {
  return new Promise((res) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
  });
}

function getAll(store) {
  return new Promise((res) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
  });
}

function formatTime(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yy} ${hh}:${mi}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  d.setDate(diff);
  return d;
}

function weekKeyFromDate(date) {
  const ws = getWeekStart(date);
  const y = ws.getFullYear();
  const m = String(ws.getMonth() + 1).padStart(2, "0");
  const d = String(ws.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clearLogoutTimer() {
  if (logoutTimer) {
    clearTimeout(logoutTimer);
    logoutTimer = null;
  }
}

function bumpAutoLogout() {
  clearLogoutTimer();
  logoutTimer = setTimeout(() => {
    state.currentUser = null;
    state.isAdmin = false;
    state.isOwner = false;
    renderLogin();
  }, state.isAdmin ? 120000 : 300000);
}

function pingActivity() {
  bumpAutoLogout();
}

async function loadSettings() {
  const storeName = await get("settings", "storeName");
  const logo = await get("settings", "logo");
  if (storeName && typeof storeName.value === "string") state.storeName = storeName.value;
  if (logo && typeof logo.value === "string") state.logo = logo.value;
}

async function saveSetting(key, value) {
  await save("settings", { key, value });
}

function renderLogin() {
  clearLogoutTimer();
  document.getElementById("app").innerHTML = `
    <div class="topbar">
      ${state.logo ? `<img src="${state.logo}" style="max-height:70px;display:block;margin:0 auto 10px auto;border-radius:10px;">` : ""}
      <h2>${state.storeName}</h2>
    </div>
    <div id="pinDisplay" style="text-align:center;font-size:24px;margin-bottom:10px;"></div>
    <div class="pinpad"></div>
  `;

  const pad = document.querySelector(".pinpad");
  let pin = "";
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, "C", 0, "OK"];

  numbers.forEach((n) => {
    const b = document.createElement("button");
    b.textContent = n;
    b.onclick = async () => {
      if (n === "C") pin = "";
      else if (n === "OK") {
        await handleLogin(pin);
        pin = "";
      } else pin += n;

      document.getElementById("pinDisplay").textContent = "•".repeat(pin.length);
    };
    pad.appendChild(b);
  });
}

async function handleLogin(pin) {
  await loadSettings();

  if (pin === ADMIN_PIN) {
    state.currentUser = "admin";
    state.isAdmin = true;
    state.isOwner = false;
    renderAdmin();
    return;
  }

  if (pin === OWNER_PIN) {
    state.currentUser = "owner";
    state.isAdmin = true;
    state.isOwner = true;
    renderAdmin();
    return;
  }

  const employees = await getAll("employees");
  const user = employees.find((e) => e.pin === pin && e.active !== false);

  if (user) {
    state.currentUser = user;
    state.isAdmin = false;
    state.isOwner = false;
    renderEmployee();
  }
}

async function findOpenShift(employeeId) {
  const shifts = await getAll("shifts");
  return shifts.find((s) => s.employeeId === employeeId && !s.out) || null;
}

async function clockIn() {
  pingActivity();
  const open = await findOpenShift(state.currentUser.id);
  if (open) return;

  const now = new Date();
  const shift = {
    shiftId: Date.now().toString() + "_" + Math.random().toString(16).slice(2),
    employeeId: state.currentUser.id,
    in: now.toISOString(),
    out: null,
    autoClosed: false
  };

  await save("shifts", shift);
  renderEmployee();
}

async function clockOut() {
  pingActivity();
  const shifts = await getAll("shifts");
  const open = shifts.find((s) => s.employeeId === state.currentUser.id && !s.out);
  if (!open) return;

  open.out = new Date().toISOString();
  await save("shifts", open);
  renderEmployee();
}

async function autoCloseAt1130() {
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();

  if (hh !== 23 || mm !== 30) return;

  const shifts = await getAll("shifts");
  const openShifts = shifts.filter((s) => !s.out);

  for (const s of openShifts) {
    s.out = new Date(now).toISOString();
    s.autoClosed = true;
    await save("shifts", s);
  }
}

function hoursBetween(inISO, outISO) {
  const a = new Date(inISO).getTime();
  const b = new Date(outISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / 3600000;
}

async function getCurrentWeekTotalsForEmployee(employee) {
  const shifts = await getAll("shifts");
  const wk = weekKeyFromDate(new Date());
  let totalHours = 0;

  shifts
    .filter((s) => s.employeeId === employee.id && s.out)
    .forEach((s) => {
      if (weekKeyFromDate(new Date(s.in)) === wk) {
        totalHours += hoursBetween(s.in, s.out);
      }
    });

  const pay = totalHours * (employee.rate || 0);
  return { totalHours, pay };
}

async function renderEmployee() {
  pingActivity();
  await autoCloseAt1130();
  await loadSettings();

  const shifts = await getAll("shifts");
  const my = shifts.filter((s) => s.employeeId === state.currentUser.id);

  const { pay } = await getCurrentWeekTotalsForEmployee(state.currentUser);

  document.getElementById("app").innerHTML = `
    <div class="topbar">
      ${state.logo ? `<img src="${state.logo}" style="max-height:70px;display:block;margin:0 auto 10px auto;border-radius:10px;">` : ""}
      <h2>${state.storeName}</h2>
    </div>

    <div style="text-align:center" onclick="pingActivity()">
      <button class="primary" onclick="clockIn()">Clock In</button>
      <button class="danger" onclick="clockOut()">Clock Out</button>
      <button onclick="renderLogin()">Log Out</button>
    </div>

    <div style="text-align:center;margin-top:10px;">Earned This Week: $${pay.toFixed(2)}</div>
  `;

  my
    .slice()
    .sort((a, b) => new Date(b.in).getTime() - new Date(a.in).getTime())
    .forEach((s) => {
      const card = document.createElement("div");
      card.className = "card";
      const inT = formatTime(new Date(s.in));
      const outT = s.out ? formatTime(new Date(s.out)) : "--";
      card.innerHTML = `
        In: ${inT}<br>
        Out: ${outT}<br>
        ${s.autoClosed ? `<div style="margin-top:8px;opacity:.8;">Auto-closed</div>` : ""}
      `;
      document.getElementById("app").appendChild(card);
    });

  document.body.onclick = () => pingActivity();
  document.body.onkeydown = () => pingActivity();
}

async function addEmployeeFromForm() {
  pingActivity();
  const name = (document.getElementById("newEmpName")?.value || "").trim();
  const id = (document.getElementById("newEmpId")?.value || "").trim();
  const pin = (document.getElementById("newEmpPin")?.value || "").trim();
  const rate = parseFloat(document.getElementById("newEmpRate")?.value || "");

  if (!name || !id || !pin || !Number.isFinite(rate)) return;

  const existing = await getAll("employees");
  if (existing.some((e) => e.id === id || e.pin === pin)) return;

  const emp = {
    id,
    name,
    pin,
    rate,
    rateHistory: [{ rate, effective: new Date().toISOString() }],
    active: true
  };

  await save("employees", emp);
  renderAdmin();
}

async function deactivateEmployee(id) {
  pingActivity();
  const emp = await get("employees", id);
  if (!emp) return;
  emp.active = false;
  await save("employees", emp);
  renderAdmin();
}

async function reactivateEmployee(id) {
  pingActivity();
  const emp = await get("employees", id);
  if (!emp) return;
  emp.active = true;
  await save("employees", emp);
  renderAdmin();
}

async function resetEmployeePin(id) {
  pingActivity();
  const emp = await get("employees", id);
  if (!emp) return;

  const newPin = (prompt("New PIN:") || "").trim();
  if (!newPin) return;

  const employees = await getAll("employees");
  if (employees.some((e) => e.pin === newPin && e.id !== id)) return;

  emp.pin = newPin;
  await save("employees", emp);
  renderAdmin();
}

async function setEmployeeRate(id) {
  pingActivity();
  const emp = await get("employees", id);
  if (!emp) return;

  const newRateStr = prompt("New hourly rate:");
  const newRate = parseFloat(newRateStr || "");
  if (!Number.isFinite(newRate)) return;

  emp.rate = newRate;
  emp.rateHistory = Array.isArray(emp.rateHistory) ? emp.rateHistory : [];
  emp.rateHistory.push({ rate: newRate, effective: new Date().toISOString() });

  await save("employees", emp);
  renderAdmin();
}

async function setStoreName() {
  pingActivity();
  const name = (prompt("Store name:") || "").trim();
  if (!name) return;
  state.storeName = name;
  await saveSetting("storeName", name);
  renderAdmin();
}

async function setLogoUrl() {
  pingActivity();
  const url = (prompt("Logo image URL:") || "").trim();
  state.logo = url;
  await saveSetting("logo", url);
  renderAdmin();
}

async function sendWebhook(payload) {
  if (!WEBHOOK_URL || WEBHOOK_URL.includes("PUT_DISCORD_WEBHOOK_URL_HERE")) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {}
}

async function editShift(shiftId) {
  pingActivity();
  const shift = await get("shifts", shiftId);
  if (!shift) return;

  const newIn = (prompt("New clock-in (MM/DD/YY HH:mm):") || "").trim();
  const newOut = (prompt("New clock-out (MM/DD/YY HH:mm) or blank:") || "").trim();

  function parseLocal(str) {
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const mm = parseInt(m[1], 10) - 1;
    const dd = parseInt(m[2], 10);
    const yy = 2000 + parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mi = parseInt(m[5], 10);
    const d = new Date(yy, mm, dd, hh, mi, 0, 0);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  const inD = parseLocal(newIn);
  if (!inD) return;

  let outISO = null;
  if (newOut) {
    const outD = parseLocal(newOut);
    if (!outD) return;
    outISO = outD.toISOString();
  }

  const before = { ...shift };
  shift.in = inD.toISOString();
  shift.out = outISO;
  shift.autoClosed = false;

  await save("shifts", shift);

  await sendWebhook({
    content: `Shift edited`,
    embeds: [
      {
        title: "Shift Edited",
        fields: [
          { name: "Shift ID", value: String(shiftId) },
          { name: "Before In", value: String(before.in || "") },
          { name: "Before Out", value: String(before.out || "") },
          { name: "After In", value: String(shift.in || "") },
          { name: "After Out", value: String(shift.out || "") }
        ]
      }
    ]
  });

  renderAdmin();
}

async function deleteShift(shiftId) {
  pingActivity();
  const shift = await get("shifts", shiftId);
  if (!shift) return;

  const ok = confirm("Delete this shift?");
  if (!ok) return;

  await del("shifts", shiftId);

  await sendWebhook({
    content: `Shift deleted`,
    embeds: [
      {
        title: "Shift Deleted",
        fields: [
          { name: "Shift ID", value: String(shiftId) },
          { name: "Employee ID", value: String(shift.employeeId || "") },
          { name: "In", value: String(shift.in || "") },
          { name: "Out", value: String(shift.out || "") }
        ]
      }
    ]
  });

  renderAdmin();
}

async function exportCSV() {
  pingActivity();
  const shifts = await getAll("shifts");
  const employees = await getAll("employees");

  let csv = "employee_name,employee_id,shift_in,shift_out,hourly_wage\n";
  shifts
    .slice()
    .sort((a, b) => new Date(a.in).getTime() - new Date(b.in).getTime())
    .forEach((s) => {
      const e = employees.find((emp) => emp.id === s.employeeId);
      const name = e ? e.name : "";
      const rate = e ? e.rate : "";
      const inT = s.in ? formatTime(new Date(s.in)) : "";
      const outT = s.out ? formatTime(new Date(s.out)) : "";
      csv += `${String(name).replaceAll(",", " ")},${String(s.employeeId || "").replaceAll(",", " ")},${String(inT).replaceAll(",", " ")},${String(outT).replaceAll(",", " ")},${rate}\n`;
    });

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "shifts.csv";
  a.click();
}

async function exportJSON() {
  pingActivity();
  const shifts = await getAll("shifts");
  const employees = await getAll("employees");
  const settings = await getAll("settings");
  const data = { employees, shifts, settings };

  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup.json";
  a.click();
}

function importJSON(e) {
  pingActivity();
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const data = JSON.parse(reader.result || "{}");
    if (Array.isArray(data.employees)) {
      for (const emp of data.employees) await save("employees", emp);
    }
    if (Array.isArray(data.shifts)) {
      for (const shift of data.shifts) await save("shifts", shift);
    }
    if (Array.isArray(data.settings)) {
      for (const s of data.settings) await save("settings", s);
    }
    await loadSettings();
    renderAdmin();
  };
  reader.readAsText(file);
}

async function renderAdmin() {
  pingActivity();
  await autoCloseAt1130();
  await loadSettings();

  const employees = await getAll("employees");
  const shifts = await getAll("shifts");

  let html = `
    <div class="topbar">
      ${state.logo ? `<img src="${state.logo}" style="max-height:70px;display:block;margin:0 auto 10px auto;border-radius:10px;">` : ""}
      <h2>${state.storeName} - Admin</h2>
    </div>

    <div style="text-align:center" onclick="pingActivity()">
      <button onclick="renderLogin()">Log Out</button>
      <button onclick="setStoreName()">Store Name</button>
      <button onclick="setLogoUrl()">Logo URL</button>
      <button onclick="exportCSV()">Export CSV</button>
      <button onclick="exportJSON()">Export JSON</button>
      <input type="file" onchange="importJSON(event)">
    </div>

    <div class="card">
      <div style="font-size:18px;margin-bottom:8px;">Add Employee</div>
      <input id="newEmpName" placeholder="Name">
      <input id="newEmpId" placeholder="Employee ID">
      <input id="newEmpPin" placeholder="PIN" inputmode="numeric">
      <input id="newEmpRate" placeholder="Hourly Rate" inputmode="decimal">
      <button class="primary" onclick="addEmployeeFromForm()">Add</button>
    </div>
  `;

  employees
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .forEach((e) => {
      const empShifts = shifts.filter((s) => s.employeeId === e.id);
      let total = 0;

      empShifts.forEach((s) => {
        if (s.out) total += hoursBetween(s.in, s.out);
      });

      html += `
        <div class="card">
          <div style="font-size:18px;">${e.name}</div>
          <div>ID: ${e.id}</div>
          <div>Rate: $${Number(e.rate || 0).toFixed(2)}</div>
          <div>Status: ${e.active === false ? "Inactive" : "Active"}</div>
          <div style="margin-top:8px;">Hours (all time): ${total.toFixed(2)}</div>
          <div>Pay (all time): $${(total * Number(e.rate || 0)).toFixed(2)}</div>
          <div style="margin-top:10px;">
            <button onclick="setEmployeeRate('${e.id}')">Set Rate</button>
            <button onclick="resetEmployeePin('${e.id}')">Reset PIN</button>
            ${e.active === false
              ? `<button class="primary" onclick="reactivateEmployee('${e.id}')">Reactivate</button>`
              : `<button class="danger" onclick="deactivateEmployee('${e.id}')">Deactivate</button>`}
          </div>
        </div>
      `;

      const recent = empShifts
        .slice()
        .sort((a, b) => new Date(b.in).getTime() - new Date(a.in).getTime())
        .slice(0, 5);

      recent.forEach((s) => {
        const inT = s.in ? formatTime(new Date(s.in)) : "--";
        const outT = s.out ? formatTime(new Date(s.out)) : "--";
        html += `
          <div class="card" style="opacity:.95;">
            <div>Employee: ${e.name} (${e.id})</div>
            <div>In: ${inT}</div>
            <div>Out: ${outT}</div>
            ${s.autoClosed ? `<div style="margin-top:6px;opacity:.85;">Auto-closed</div>` : ""}
            <div style="margin-top:10px;">
              <button onclick="editShift('${s.shiftId}')">Edit Shift</button>
              <button class="danger" onclick="deleteShift('${s.shiftId}')">Delete Shift</button>
            </div>
          </div>
        `;
      });
    });

  document.getElementById("app").innerHTML = html;

  document.body.onclick = () => pingActivity();
  document.body.onkeydown = () => pingActivity();
}

initDB().then(async () => {
  await loadSettings();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  setInterval(autoCloseAt1130, 30000);
  renderLogin();
});