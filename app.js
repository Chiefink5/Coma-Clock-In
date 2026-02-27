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
let modalEl = null;

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
let schedState = { weekKey: null, selected: null };

function qs(sel){ return document.querySelector(sel); }

function initDB(){
  return new Promise((res)=>{
    const request = indexedDB.open("clockDB", 2);
    request.onupgradeneeded = (e)=>{
      db = e.target.result;
      if(!db.objectStoreNames.contains("employees")) db.createObjectStore("employees", { keyPath:"id" });
      if(!db.objectStoreNames.contains("shifts")) db.createObjectStore("shifts", { keyPath:"shiftId" });
      if(!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath:"key" });
      if(!db.objectStoreNames.contains("schedule")) db.createObjectStore("schedule", { keyPath:"id" });
    };
    request.onsuccess = (e)=>{ db = e.target.result; res(); };
  });
}

function save(store, data){
  return new Promise((res)=>{
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(data);
    tx.oncomplete = ()=>res();
  });
}

function del(store, key){
  return new Promise((res)=>{
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = ()=>res();
  });
}

function get(store, key){
  return new Promise((res)=>{
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = ()=>res(req.result);
  });
}

function getAll(store){
  return new Promise((res)=>{
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = ()=>res(req.result || []);
  });
}

function escapeHTML(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function formatTime(d){
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  return `${mm}/${dd}/${yy} ${hh}:${mi}`;
}

function getWeekStart(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  const day = d.getDay();
  const diff = d.getDate() - (day===0 ? 6 : day-1);
  d.setDate(diff);
  return d;
}

function weekKeyFromDate(date){
  const ws = getWeekStart(date);
  const y = ws.getFullYear();
  const m = String(ws.getMonth()+1).padStart(2,"0");
  const d = String(ws.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function clearLogoutTimer(){
  if(logoutTimer){ clearTimeout(logoutTimer); logoutTimer = null; }
}

function bumpAutoLogout(){
  clearLogoutTimer();
  logoutTimer = setTimeout(()=>{
    state.currentUser = null;
    state.isAdmin = false;
    state.isOwner = false;
    closeModal();
    renderLogin();
  }, state.isAdmin ? 120000 : 300000);
}

function pingActivity(){
  bumpAutoLogout();
}

async function loadSettings(){
  const storeName = await get("settings","storeName");
  const logo = await get("settings","logo");
  if(storeName && typeof storeName.value === "string") state.storeName = storeName.value;
  if(logo && typeof logo.value === "string") state.logo = logo.value;
}

async function saveSetting(key, value){
  await save("settings",{ key, value });
}

function setAppHTML(html){
  qs("#app").innerHTML = html;
  document.body.onclick = ()=>pingActivity();
  document.body.onkeydown = ()=>pingActivity();
}

function openModal(title, bodyHTML){
  closeModal();
  modalEl = document.createElement("div");
  modalEl.className = "modalOverlay";
  modalEl.innerHTML = `
    <div class="modal">
      <div class="modalHeader">
        <h3>${title}</h3>
        <button class="modalClose" id="modalCloseBtn">✕</button>
      </div>
      <div class="modalBody">${bodyHTML}</div>
    </div>
  `;
  document.body.appendChild(modalEl);
  qs("#modalCloseBtn").onclick = ()=>closeModal();
  modalEl.addEventListener("click", (e)=>{ if(e.target === modalEl) closeModal(); });
}

function closeModal(){
  if(modalEl){ modalEl.remove(); modalEl = null; }
}

function brandHTML(sub){
  return `
    <div class="topbar">
      <div class="brand">
        ${state.logo ? `<img src="${state.logo}">` : ``}
        <div>
          <h2>${state.storeName}</h2>
          ${sub ? `<div class="subline">${sub}</div>` : ``}
        </div>
      </div>
    </div>
  `;
}

function navBarHTML(active){
  const isEmp = !!state.currentUser && !state.isAdmin;
  return `
    <div class="row" style="margin-top:12px;">
      ${isEmp
        ? `<button class="btn ${active==="clock"?"accent":""}" onclick="renderEmployee()">Clock</button>`
        : `<button class="btn ${active==="clock"?"accent":""}" onclick="renderAdmin()">Clock</button>`
      }
      <button class="btn ${active==="schedule"?"accent":""}" onclick="${isEmp ? "renderScheduleEmployee()" : "renderScheduleAdmin()"}">Schedule</button>
      <button class="btn" onclick="renderLogin()">Log Out</button>
    </div>
  `;
}

function fmtDateLocal(iso){
  if(!iso) return "--";
  const d = new Date(iso);
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function fmtTimeLocal12(iso){
  if(!iso) return "--";
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if(h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function plural(n, word){
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function fmtHoursDeltaWords(deltaHours){
  const v = Number(deltaHours || 0);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const absMinutes = Math.round(Math.abs(v) * 60);
  const hrs = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  if(absMinutes === 0) return "0 minutes";
  if(hrs > 0 && mins > 0) return `${sign}${plural(hrs, "hour")} ${plural(mins, "minute")}`;
  if(hrs > 0) return `${sign}${plural(hrs, "hour")}`;
  return `${sign}${plural(mins, "minute")}`;
}

async function employeeLabel(employeeId){
  const emp = await get("employees", employeeId);
  if(!emp) return { name: "Unknown", id: String(employeeId || "") };
  return { name: String(emp.name || "Unknown"), id: String(emp.id || employeeId || "") };
}

async function sendWebhook(payload){
  if(!WEBHOOK_URL || WEBHOOK_URL.includes("PUT_DISCORD_WEBHOOK_URL_HERE")) return;
  try{
    await fetch(WEBHOOK_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
  }catch(e){}
}

async function requestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      await navigator.storage.persist();
    }
  }catch(e){}
}

function renderLogin(){
  clearLogoutTimer();
  setAppHTML(`
    ${brandHTML("Enter your PIN")}
    <div class="pinwrap">
      <div class="pinDisplay" id="pinDisplay"></div>
      <div class="pinpad" id="pinpad"></div>
    </div>
  `);

  const pad = qs("#pinpad");
  const display = qs("#pinDisplay");
  let pin = "";
  const keys = [1,2,3,4,5,6,7,8,9,"C",0,"OK"];

  keys.forEach((k)=>{
    const b = document.createElement("button");
    b.className = "pinbtn";
    if(k==="OK") b.classList.add("ok");
    if(k==="C") b.classList.add("clear");
    b.textContent = k;
    b.onclick = async ()=>{
      pingActivity();
      if(k==="C"){ pin=""; }
      else if(k==="OK"){ await handleLogin(pin); pin=""; }
      else { pin += String(k); }
      display.textContent = pin ? "•".repeat(pin.length) : "";
    };
    pad.appendChild(b);
  });
}

async function handleLogin(pin){
  await loadSettings();

  if(pin === ADMIN_PIN){
    state.currentUser = "admin";
    state.isAdmin = true;
    state.isOwner = false;
    renderAdmin();
    return;
  }

  if(pin === OWNER_PIN){
    state.currentUser = "owner";
    state.isAdmin = true;
    state.isOwner = true;
    renderAdmin();
    return;
  }

  const employees = await getAll("employees");
  const user = employees.find(e => e.pin === pin && e.active !== false);

  if(user){
    state.currentUser = user;
    state.isAdmin = false;
    state.isOwner = false;
    renderEmployee();
  }
}

async function findOpenShift(employeeId){
  const shifts = await getAll("shifts");
  return shifts.find(s => s.employeeId === employeeId && !s.out) || null;
}

function hoursBetween(inISO, outISO){
  const a = new Date(inISO).getTime();
  const b = new Date(outISO).getTime();
  if(!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / 3600000;
}

async function autoCloseAt1130(){
  const now = new Date();
  if(now.getHours() !== 23 || now.getMinutes() !== 30) return;
  const shifts = await getAll("shifts");
  const open = shifts.filter(s => !s.out);
  for(const s of open){
    s.out = new Date(now).toISOString();
    s.autoClosed = true;
    await save("shifts", s);
  }
}

async function clockIn(){
  pingActivity();
  const open = await findOpenShift(state.currentUser.id);
  if(open) return;

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

async function clockOut(){
  pingActivity();
  const shifts = await getAll("shifts");
  const open = shifts.find(s => s.employeeId === state.currentUser.id && !s.out);
  if(!open) return;

  open.out = new Date().toISOString();
  await save("shifts", open);
  renderEmployee();
}

async function getCurrentWeekTotalsForEmployee(employee){
  const shifts = await getAll("shifts");
  const wk = weekKeyFromDate(new Date());
  let totalHours = 0;

  shifts
    .filter(s => s.employeeId === employee.id && s.out)
    .forEach(s=>{
      if(weekKeyFromDate(new Date(s.in)) === wk){
        totalHours += hoursBetween(s.in, s.out);
      }
    });

  const pay = totalHours * (employee.rate || 0);
  return { totalHours, pay };
}

function computeOvertime(totalHours){
  return Math.max(0, totalHours - 40);
}

async function openOvertimeModal(employeeId){
  if(!state.isOwner) return;

  const emp = await get("employees", employeeId);
  if(!emp) return;

  const shifts = await getAll("shifts");
  const wk = weekKeyFromDate(new Date());

  let totalHours = 0;
  shifts
    .filter(s => s.employeeId === emp.id && s.out)
    .forEach(s=>{
      if(weekKeyFromDate(new Date(s.in)) === wk){
        totalHours += hoursBetween(s.in, s.out);
      }
    });

  const otHours = computeOvertime(totalHours);
  const rate = Number(emp.rate || 0);
  const otValue = otHours * rate * 0.5;

  openModal(`${escapeHTML(emp.name)}`, `
    <div class="card soft" style="margin-top:0;">
      <div class="kpi" style="justify-content:flex-start;">
        <div class="pill"><strong>Total (wk)</strong>&nbsp;&nbsp;${totalHours.toFixed(2)} hrs</div>
        <div class="pill"><strong>OT (wk)</strong>&nbsp;&nbsp;${otHours.toFixed(2)} hrs</div>
        <div class="pill"><strong>OT $</strong>&nbsp;&nbsp;$${otValue.toFixed(2)}</div>
      </div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
  `);
}

async function renderEmployee(){
  pingActivity();
  await autoCloseAt1130();
  await loadSettings();

  const me = state.currentUser;
  const shifts = await getAll("shifts");
  const my = shifts
    .filter(s => s.employeeId === me.id)
    .sort((a,b)=> new Date(b.in).getTime() - new Date(a.in).getTime());

  const totals = await getCurrentWeekTotalsForEmployee(me);

  setAppHTML(`
    ${brandHTML(`Welcome ${escapeHTML(me.name)}!`)}
    ${navBarHTML("clock")}
    <div class="kpi">
      <div class="pill"><strong>Earned this week</strong>&nbsp;&nbsp;$${totals.pay.toFixed(2)}</div>
      <div class="pill"><strong>Rate</strong>&nbsp;&nbsp;$${Number(me.rate||0).toFixed(2)}/hr</div>
    </div>

    <div class="row">
      <button class="btn primary shimmer" onclick="clockIn()">Clock In</button>
      <button class="btn danger shimmer" onclick="clockOut()">Clock Out</button>
    </div>

    <div class="list" id="shiftList"></div>
  `);

  const list = qs("#shiftList");

  if(my.length === 0){
    const empty = document.createElement("div");
    empty.className = "card soft";
    empty.innerHTML = `<div class="note">No shifts yet.</div>`;
    list.appendChild(empty);
    return;
  }

  my.forEach((s)=>{
    const inT = s.in ? formatTime(new Date(s.in)) : "--";
    const outT = s.out ? formatTime(new Date(s.out)) : "--";
    const dur = s.out ? hoursBetween(s.in, s.out) : 0;

    const row = document.createElement("div");
    row.className = "shiftRow";
    row.innerHTML = `
      <div class="left">
        <div><strong>In:</strong> ${inT}</div>
        <div><strong>Out:</strong> ${outT}</div>
        <div class="badge ${s.autoClosed ? "glow" : ""}">${s.autoClosed ? "Auto-closed (11:30)" : "Logged"}</div>
      </div>
      <div class="right">
        ${s.out ? `<div><strong>${dur.toFixed(2)}</strong> hrs</div>` : `<div><strong>Open</strong></div>`}
      </div>
    `;
    list.appendChild(row);
  });
}

async function openAddEmployeeModal(){
  pingActivity();
  openModal("Add Employee", `
    <div class="grid2">
      <input class="field" id="newEmpName" placeholder="Name">
      <input class="field" id="newEmpId" placeholder="Employee ID">
      <input class="field" id="newEmpPin" placeholder="PIN" inputmode="numeric">
      <input class="field" id="newEmpRate" placeholder="Hourly Rate" inputmode="decimal">
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="addEmployeeFromModal()">Add</button>
    </div>
  `);
}

async function addEmployeeFromModal(){
  pingActivity();
  const name = (qs("#newEmpName")?.value || "").trim();
  const id = (qs("#newEmpId")?.value || "").trim();
  const pin = (qs("#newEmpPin")?.value || "").trim();
  const rate = parseFloat(qs("#newEmpRate")?.value || "");

  if(!name || !id || !pin || !Number.isFinite(rate)) return;

  const existing = await getAll("employees");
  if(existing.some(e => e.id === id || e.pin === pin)) return;

  const emp = {
    id,
    name,
    pin,
    rate,
    rateHistory: [{ rate, effective: new Date().toISOString() }],
    active: true
  };

  await save("employees", emp);
  closeModal();
  renderAdmin();
}

async function openSettingsModal(){
  pingActivity();
  await loadSettings();
  openModal("Settings", `
    <div class="grid2">
      <input class="field" id="setStoreName" placeholder="Store Name" value="${escapeHTML(state.storeName)}">
      <input class="field" id="setLogoUrl" placeholder="Logo Image URL" value="${escapeHTML(state.logo)}">
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn accent" onclick="saveSettingsFromModal()">Save</button>
    </div>
  `);
}

async function saveSettingsFromModal(){
  pingActivity();
  const name = (qs("#setStoreName")?.value || "").trim();
  const logo = (qs("#setLogoUrl")?.value || "").trim();

  if(name){
    state.storeName = name;
    await saveSetting("storeName", name);
  }
  state.logo = logo;
  await saveSetting("logo", logo);

  closeModal();
  renderAdmin();
}

async function setEmployeeRate(id){
  pingActivity();
  const emp = await get("employees", id);
  if(!emp) return;

  openModal(`Set Rate — ${escapeHTML(emp.name)}`, `
    <div class="grid2">
      <input class="field" id="newRate" placeholder="New hourly rate" inputmode="decimal">
      <div class="note" style="align-self:center;">Current: $${Number(emp.rate||0).toFixed(2)}</div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveEmployeeRate('${escapeHTML(emp.id)}')">Save</button>
    </div>
  `);
}

async function saveEmployeeRate(id){
  pingActivity();
  const emp = await get("employees", id);
  if(!emp) return;

  const newRate = parseFloat(qs("#newRate")?.value || "");
  if(!Number.isFinite(newRate)) return;

  emp.rate = newRate;
  emp.rateHistory = Array.isArray(emp.rateHistory) ? emp.rateHistory : [];
  emp.rateHistory.push({ rate:newRate, effective:new Date().toISOString() });

  await save("employees", emp);
  closeModal();
  renderAdmin();
}

async function resetEmployeePin(id){
  pingActivity();
  const emp = await get("employees", id);
  if(!emp) return;

  openModal(`Reset PIN — ${escapeHTML(emp.name)}`, `
    <div class="grid2">
      <input class="field" id="newPin" placeholder="New PIN" inputmode="numeric">
      <div class="note" style="align-self:center;">Make it unique</div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveEmployeePin('${escapeHTML(emp.id)}')">Save</button>
    </div>
  `);
}

async function saveEmployeePin(id){
  pingActivity();
  const emp = await get("employees", id);
  if(!emp) return;

  const newPin = (qs("#newPin")?.value || "").trim();
  if(!newPin) return;

  const all = await getAll("employees");
  if(all.some(e => e.pin === newPin && e.id !== id)) return;

  emp.pin = newPin;
  await save("employees", emp);

  closeModal();
  renderAdmin();
}

async function deactivateEmployee(id){
  pingActivity();
  const emp = await get("employees", id);
  if(!emp) return;
  emp.active = false;
  await save("employees", emp);
  renderAdmin();
}

async function reactivateEmployee(id){
  pingActivity();
  const emp = await get("employees", id);
  if(!emp) return;
  emp.active = true;
  await save("employees", emp);
  renderAdmin();
}

function parseLocal(str){
  const m = String(str||"").trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if(!m) return null;
  const mm = parseInt(m[1],10)-1;
  const dd = parseInt(m[2],10);
  const yy = 2000 + parseInt(m[3],10);
  const hh = parseInt(m[4],10);
  const mi = parseInt(m[5],10);
  const d = new Date(yy, mm, dd, hh, mi, 0, 0);
  if(Number.isNaN(d.getTime())) return null;
  return d;
}

async function editShift(shiftId){
  pingActivity();
  const shift = await get("shifts", shiftId);
  if(!shift) return;

  const beforeIn = shift.in;
  const beforeOut = shift.out;

  openModal("Edit Shift", `
    <div class="grid2">
      <input class="field" id="editIn" placeholder="Clock-in MM/DD/YY HH:mm" value="${shift.in ? formatTime(new Date(shift.in)) : ""}">
      <input class="field" id="editOut" placeholder="Clock-out MM/DD/YY HH:mm (blank = open)" value="${shift.out ? formatTime(new Date(shift.out)) : ""}">
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn accent" onclick="saveShiftEdit('${escapeHTML(shiftId)}','${escapeHTML(beforeIn||"")}','${escapeHTML(beforeOut||"")}')">Save</button>
    </div>
  `);
}

async function saveShiftEdit(shiftId, beforeIn, beforeOut){
  pingActivity();
  const shift = await get("shifts", shiftId);
  if(!shift) return;

  const newIn = parseLocal(qs("#editIn")?.value || "");
  const newOutRaw = (qs("#editOut")?.value || "").trim();
  const newOut = newOutRaw ? parseLocal(newOutRaw) : null;

  if(!newIn) return;
  const outISO = newOut ? newOut.toISOString() : null;

  shift.in = newIn.toISOString();
  shift.out = outISO;
  shift.autoClosed = false;

  await save("shifts", shift);

  const beforeHours = beforeOut ? hoursBetween(beforeIn, beforeOut) : 0;
  const afterHours = shift.out ? hoursBetween(shift.in, shift.out) : 0;
  const diffHours = afterHours - beforeHours;

  const empInfo = await employeeLabel(shift.employeeId);
  const dateStr = fmtDateLocal(shift.in);

  await sendWebhook({
    content: `Shift Edited`,
    embeds: [{
      title: "Shift Edited",
      fields: [
        { name: "Employee", value: `> ${empInfo.name} (${empInfo.id})`, inline: false },
        { name: "Date", value: `${dateStr}`, inline: true },
        { name: "Before", value: `> In: ${fmtTimeLocal12(beforeIn)}\n> Out: ${fmtTimeLocal12(beforeOut)}`, inline: false },
        { name: "After", value: `> In: ${fmtTimeLocal12(shift.in)}\n> Out: ${fmtTimeLocal12(shift.out)}`, inline: false },
        { name: "Hours Difference", value: `> ${fmtHoursDeltaWords(diffHours)}`, inline: false }
      ]
    }]
  });

  closeModal();
  renderAdmin();
}

async function deleteShift(shiftId){
  pingActivity();
  openModal("Delete Shift", `
    <div class="note">This will remove the shift permanently.</div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn danger" onclick="confirmDeleteShift('${escapeHTML(shiftId)}')">Delete</button>
    </div>
  `);
}

async function confirmDeleteShift(shiftId){
  pingActivity();
  const shift = await get("shifts", shiftId);
  if(!shift) return;

  await del("shifts", shiftId);

  const empInfo = await employeeLabel(shift.employeeId);
  const dateStr = fmtDateLocal(shift.in);
  const dur = shift.out ? hoursBetween(shift.in, shift.out) : 0;

  await sendWebhook({
    content: `Shift Deleted`,
    embeds: [{
      title: "Shift Deleted",
      fields: [
        { name: "Employee", value: `> ${empInfo.name} (${empInfo.id})`, inline: false },
        { name: "Date", value: `${dateStr}`, inline: true },
        { name: "Shift", value: `> In: ${fmtTimeLocal12(shift.in)}\n> Out: ${fmtTimeLocal12(shift.out)}\n> Length: ${dur.toFixed(2)} hrs`, inline: false }
      ]
    }]
  });

  closeModal();
  renderAdmin();
}

async function exportCSV(){
  pingActivity();
  const shifts = await getAll("shifts");
  const employees = await getAll("employees");

  let csv = "employee_name,employee_id,shift_in,shift_out,hourly_wage\n";
  shifts
    .slice()
    .sort((a,b)=> new Date(a.in).getTime() - new Date(b.in).getTime())
    .forEach((s)=>{
      const e = employees.find(emp => emp.id === s.employeeId);
      const name = e ? e.name : "";
      const rate = e ? e.rate : "";
      const inT = s.in ? formatTime(new Date(s.in)) : "";
      const outT = s.out ? formatTime(new Date(s.out)) : "";
      csv += `${String(name).replaceAll(","," ")},${String(s.employeeId||"").replaceAll(","," ")},${String(inT).replaceAll(","," ")},${String(outT).replaceAll(","," ")},${rate}\n`;
    });

  const blob = new Blob([csv], { type:"text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "shifts.csv";
  a.click();
}

async function exportJSON(){
  pingActivity();
  const shifts = await getAll("shifts");
  const employees = await getAll("employees");
  const settings = await getAll("settings");
  const schedule = await getAll("schedule");
  const data = { employees, shifts, settings, schedule };

  const blob = new Blob([JSON.stringify(data)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup.json";
  a.click();
}

function triggerImport(){
  pingActivity();
  qs("#importFile").click();
}

function importJSON(e){
  pingActivity();
  const file = e.target.files[0];
  if(!file) return;

  const reader = new FileReader();
  reader.onload = async ()=>{
    const data = JSON.parse(reader.result || "{}");
    if(Array.isArray(data.employees)) for(const emp of data.employees) await save("employees", emp);
    if(Array.isArray(data.shifts)) for(const shift of data.shifts) await save("shifts", shift);
    if(Array.isArray(data.settings)) for(const s of data.settings) await save("settings", s);
    if(Array.isArray(data.schedule)) for(const x of data.schedule) await save("schedule", x);
    await loadSettings();
    renderAdmin();
  };
  reader.readAsText(file);
  e.target.value = "";
}

async function renderAdmin(){
  pingActivity();
  await autoCloseAt1130();
  await loadSettings();

  const employees = (await getAll("employees"))
    .slice()
    .sort((a,b)=> String(a.name||"").localeCompare(String(b.name||"")));

  const shifts = await getAll("shifts");
  const wk = weekKeyFromDate(new Date());

  setAppHTML(`
    ${brandHTML(state.isOwner ? "Admin (Owner)" : "Admin")}
    ${navBarHTML("clock")}
    <div class="row">
      <button class="btn accent" onclick="openSettingsModal()">Settings</button>
      <button class="btn primary" onclick="openAddEmployeeModal()">Add Employee</button>
      <button class="btn" onclick="exportCSV()">Export CSV</button>
      <button class="btn" onclick="exportJSON()">Export JSON</button>
      <button class="btn" onclick="triggerImport()">Import</button>
      <input id="importFile" type="file" style="display:none" onchange="importJSON(event)">
    </div>

    <div class="hr"></div>
    <div class="list" id="empList"></div>
  `);

  const list = qs("#empList");

  if(employees.length === 0){
    const empty = document.createElement("div");
    empty.className = "card soft";
    empty.innerHTML = `<div class="note">No employees yet. Tap “Add Employee”.</div>`;
    list.appendChild(empty);
    return;
  }

  for(const e of employees){
    const empShifts = shifts
      .filter(s => s.employeeId === e.id)
      .sort((a,b)=> new Date(b.in).getTime() - new Date(a.in).getTime());

    let totalAll = 0;
    empShifts.forEach((s)=>{ if(s.out) totalAll += hoursBetween(s.in, s.out); });

    let totalWeek = 0;
    empShifts.forEach((s)=>{
      if(s.out && weekKeyFromDate(new Date(s.in)) === wk){
        totalWeek += hoursBetween(s.in, s.out);
      }
    });

    const recent = empShifts.slice(0, 8);

    const hoursTap = state.isOwner
      ? `onclick="event.preventDefault(); event.stopPropagation(); openOvertimeModal('${escapeHTML(e.id)}')"`
      : ``;

    const details = document.createElement("details");
    details.className = "emp";
    details.innerHTML = `
      <summary>
        <div class="empHead">
          <div class="empTitle">${escapeHTML(e.name)} <span class="badge ${e.active===false ? "" : "glow"}">${e.active===false ? "Inactive" : "Active"}</span></div>
          <div class="empMeta">ID: ${escapeHTML(e.id)} • Rate: $${Number(e.rate||0).toFixed(2)}/hr</div>
        </div>
        <div class="empTail">
          <div style="text-align:right;">
            <div ${hoursTap} style="${state.isOwner ? "cursor:pointer;" : ""}">
              <strong>${totalWeek.toFixed(2)}</strong> hrs
            </div>
            <div style="opacity:.7;">All: ${totalAll.toFixed(2)} hrs</div>
          </div>
        </div>
      </summary>

      <div class="empBody">
        <div class="row" style="justify-content:flex-start;">
          <button class="btn slim" onclick="setEmployeeRate('${escapeHTML(e.id)}')">Set Rate</button>
          <button class="btn slim" onclick="resetEmployeePin('${escapeHTML(e.id)}')">Reset PIN</button>
          ${e.active===false
            ? `<button class="btn slim primary" onclick="reactivateEmployee('${escapeHTML(e.id)}')">Reactivate</button>`
            : `<button class="btn slim danger" onclick="deactivateEmployee('${escapeHTML(e.id)}')">Deactivate</button>`}
        </div>

        <div class="hr"></div>
        <div class="note">Recent shifts</div>
        <div class="list" id="recent_${escapeHTML(e.id)}"></div>
      </div>
    `;

    list.appendChild(details);

    const recentList = qs(`#recent_${CSS.escape(e.id)}`);

    if(recent.length === 0){
      const empty = document.createElement("div");
      empty.className = "card soft";
      empty.innerHTML = `<div class="note">No shifts logged.</div>`;
      recentList.appendChild(empty);
      continue;
    }

    for(const s of recent){
      const inT = s.in ? formatTime(new Date(s.in)) : "--";
      const outT = s.out ? formatTime(new Date(s.out)) : "--";
      const dur = s.out ? hoursBetween(s.in, s.out) : 0;

      const row = document.createElement("div");
      row.className = "shiftRow";
      row.innerHTML = `
        <div class="left">
          <div><strong>In:</strong> ${inT}</div>
          <div><strong>Out:</strong> ${outT}</div>
          <div class="badge ${s.autoClosed ? "glow" : ""}">${s.autoClosed ? "Auto-closed (11:30)" : "Logged"}</div>
        </div>
        <div class="right">
          ${s.out ? `<div><strong>${dur.toFixed(2)}</strong> hrs</div>` : `<div><strong>Open</strong></div>`}
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn slim" onclick="editShift('${escapeHTML(s.shiftId)}')">Edit</button>
            <button class="btn slim danger" onclick="deleteShift('${escapeHTML(s.shiftId)}')">Delete</button>
          </div>
        </div>
      `;
      recentList.appendChild(row);
    }
  }
}

function weekLabel(weekKey){
  const d = new Date(weekKey + "T00:00:00");
  const end = new Date(d); end.setDate(end.getDate()+6);
  const mm1 = String(d.getMonth()+1).padStart(2,"0");
  const dd1 = String(d.getDate()).padStart(2,"0");
  const mm2 = String(end.getMonth()+1).padStart(2,"0");
  const dd2 = String(end.getDate()).padStart(2,"0");
  return `${mm1}/${dd1} - ${mm2}/${dd2}`;
}

function addDaysToWeekKey(weekKey, deltaDays){
  const d = new Date(weekKey + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return weekKeyFromDate(d);
}

function schedId(weekKey, employeeId, dayIndex){
  return `${weekKey}|${employeeId}|${dayIndex}`;
}

async function getScheduleForWeek(weekKey){
  const all = await getAll("schedule");
  return all.filter(x => x.weekKey === weekKey);
}

async function getScheduleCell(weekKey, employeeId, dayIndex){
  return await get("schedule", schedId(weekKey, employeeId, dayIndex));
}

async function setScheduleCell(weekKey, employeeId, dayIndex, start, end){
  const entry = {
    id: schedId(weekKey, employeeId, dayIndex),
    weekKey,
    employeeId,
    dayIndex,
    start: start || "",
    end: end || "",
    updatedAt: new Date().toISOString()
  };
  await save("schedule", entry);
}

async function clearScheduleCell(weekKey, employeeId, dayIndex){
  await del("schedule", schedId(weekKey, employeeId, dayIndex));
}

async function clearScheduleWeek(weekKey){
  const all = await getScheduleForWeek(weekKey);
  for(const x of all) await del("schedule", x.id);
}

async function copyScheduleWeek(fromWeekKey, toWeekKey){
  await clearScheduleWeek(toWeekKey);
  const from = await getScheduleForWeek(fromWeekKey);
  for(const x of from){
    await setScheduleCell(toWeekKey, x.employeeId, x.dayIndex, x.start, x.end);
  }
}

function schedulePrevWeek(){ schedState.weekKey = addDaysToWeekKey(schedState.weekKey, -7); schedState.selected=null; renderScheduleAdmin(); }
function scheduleNextWeek(){ schedState.weekKey = addDaysToWeekKey(schedState.weekKey,  7); schedState.selected=null; renderScheduleAdmin(); }
function scheduleThisWeek(){ schedState.weekKey = weekKeyFromDate(new Date()); schedState.selected=null; renderScheduleAdmin(); }

async function scheduleCopyLastWeek(){
  pingActivity();
  const from = addDaysToWeekKey(schedState.weekKey, -7);
  await copyScheduleWeek(from, schedState.weekKey);
  renderScheduleAdmin();
}

async function scheduleClearWeek(){
  pingActivity();
  await clearScheduleWeek(schedState.weekKey);
  schedState.selected = null;
  renderScheduleAdmin();
}

function scheduleSelectCell(employeeId, dayIndex){
  schedState.selected = { employeeId, dayIndex };
  renderScheduleAdmin();
}

async function scheduleSave(){
  pingActivity();
  const sel = schedState.selected;
  if(!sel) return;

  const start = (qs("#schedStart")?.value || "").trim();
  const end = (qs("#schedEnd")?.value || "").trim();

  if(!start && !end){
    await clearScheduleCell(schedState.weekKey, sel.employeeId, sel.dayIndex);
  } else {
    await setScheduleCell(schedState.weekKey, sel.employeeId, sel.dayIndex, start, end);
  }

  renderScheduleAdmin();
}

async function scheduleClear(){
  pingActivity();
  const sel = schedState.selected;
  if(!sel) return;
  await clearScheduleCell(schedState.weekKey, sel.employeeId, sel.dayIndex);
  renderScheduleAdmin();
}

async function renderScheduleAdmin(){
  pingActivity();
  await loadSettings();

  if(!schedState.weekKey) schedState.weekKey = weekKeyFromDate(new Date());

  const employees = (await getAll("employees"))
    .filter(e => e.active !== false)
    .sort((a,b)=> String(a.name||"").localeCompare(String(b.name||"")));

  const weekKey = schedState.weekKey;
  const weekData = await getScheduleForWeek(weekKey);

  let html = `
    ${brandHTML(state.isOwner ? "Admin (Owner) — Schedule" : "Admin — Schedule")}
    ${navBarHTML("schedule")}

    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <button class="btn slim" onclick="schedulePrevWeek()">◀ Prev</button>
        <div style="text-align:center;">
          <div style="font-weight:700;">Week</div>
          <div style="opacity:.85;">${weekLabel(weekKey)}</div>
        </div>
        <button class="btn slim" onclick="scheduleNextWeek()">Next ▶</button>
      </div>
      <div class="row" style="justify-content:center;margin-top:10px;">
        <button class="btn slim" onclick="scheduleThisWeek()">This Week</button>
        <button class="btn slim" onclick="scheduleCopyLastWeek()">Copy Last Week</button>
        <button class="btn slim danger" onclick="scheduleClearWeek()">Clear Week</button>
      </div>
    </div>

    <div class="card" style="overflow:auto;">
      <table style="width:100%; border-collapse:collapse; min-width:720px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Employee</th>
            ${DAYS.map(d=>`<th style="text-align:center;padding:10px;border-bottom:1px solid var(--line);">${d}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${employees.map(emp=>{
            return `
              <tr>
                <td style="padding:10px;border-bottom:1px solid var(--line); white-space:nowrap;">
                  <div style="font-weight:700;">${escapeHTML(emp.name)}</div>
                  <div style="opacity:.75;font-size:12px;">${escapeHTML(emp.id)}</div>
                </td>
                ${DAYS.map((_,dayIndex)=>{
                  const cell = weekData.find(x => x.employeeId === emp.id && x.dayIndex === dayIndex);
                  const label = cell && cell.start && cell.end ? `${cell.start}–${cell.end}` : "Off";
                  const isSel = schedState.selected && schedState.selected.employeeId===emp.id && schedState.selected.dayIndex===dayIndex;
                  return `
                    <td
                      onclick="scheduleSelectCell('${escapeHTML(emp.id)}',${dayIndex})"
                      style="padding:10px;border-bottom:1px solid var(--line); text-align:center; cursor:pointer; ${isSel ? "outline:2px solid rgba(124,92,255,.6); outline-offset:-2px; border-radius:10px;" : ""}"
                    >
                      <span class="badge ${cell && cell.start && cell.end ? "glow" : ""}">${label}</span>
                    </td>
                  `;
                }).join("")}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div class="card" id="schedEditor"></div>
  `;

  setAppHTML(html);

  const editor = qs("#schedEditor");
  if(!schedState.selected){
    editor.innerHTML = `<div class="note">Tap a cell above to set a shift.</div>`;
    return;
  }

  const { employeeId, dayIndex } = schedState.selected;
  const emp = await get("employees", employeeId);
  const existing = await getScheduleCell(weekKey, employeeId, dayIndex);

  const startVal = existing?.start || "";
  const endVal = existing?.end || "";

  editor.innerHTML = `
    <div style="font-weight:700;font-size:16px;">Edit Shift</div>
    <div class="note" style="margin-top:6px;">${escapeHTML(emp?.name || "Employee")} • ${DAYS[dayIndex]} • Week ${weekLabel(weekKey)}</div>
    <div class="grid2" style="margin-top:12px;">
      <div>
        <div class="note">Start</div>
        <input class="field" id="schedStart" type="time" value="${startVal}">
      </div>
      <div>
        <div class="note">End</div>
        <input class="field" id="schedEnd" type="time" value="${endVal}">
      </div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="scheduleSave()">Save</button>
      <button class="btn danger" onclick="scheduleClear()">Clear</button>
    </div>
  `;
}

async function renderScheduleEmployee(){
  pingActivity();
  await loadSettings();

  const me = state.currentUser;
  const weekKey = weekKeyFromDate(new Date());
  const weekData = await getScheduleForWeek(weekKey);
  const mine = weekData.filter(x => x.employeeId === me.id).sort((a,b)=> a.dayIndex - b.dayIndex);

  setAppHTML(`
    ${brandHTML(`Welcome ${escapeHTML(me.name)} — Schedule`)}
    ${navBarHTML("schedule")}
    <div class="card">
      <div style="font-weight:700;">This Week</div>
      <div class="note">${weekLabel(weekKey)}</div>
    </div>
    <div class="list" id="schedList"></div>
  `);

  const list = qs("#schedList");

  for(let i=0;i<7;i++){
    const entry = mine.find(x => x.dayIndex === i);
    const label = entry && entry.start && entry.end ? `${entry.start} – ${entry.end}` : "Off";

    const row = document.createElement("div");
    row.className = "shiftRow";
    row.innerHTML = `
      <div class="left">
        <div><strong>${DAYS[i]}</strong></div>
        <div class="badge ${entry && entry.start && entry.end ? "glow" : ""}">${label}</div>
      </div>
      <div class="right"></div>
    `;
    list.appendChild(row);
  }
}

initDB().then(async ()=>{
  await requestPersistentStorage();
  await loadSettings();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  setInterval(autoCloseAt1130, 30000);
  renderLogin();
});
