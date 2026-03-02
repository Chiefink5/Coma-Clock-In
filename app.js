const ADMIN_PIN = "7482";
const OWNER_PIN = "1421";
const WEBHOOK_URL = "https://discord.com/api/webhooks/1476784807634534532/sZfyQIF-YZQnyWOqgI3Wmkca6Rv9mCr2FxbqCvwq-DM0w4JQVv0YE0qULW7f7ImTM-Td";
const DEV_UNLOCK_CODE = "2521";

let state = {
  currentUser: null,
  isAdmin: false,
  isOwner: false,
  storeName: "Shop Clock",
  logo: "",
  premiumUnlocked: false,
  showPremiumBar: false,
  premiumFlags: {
    schedule:false,
    payroll:false,
    weekLock:false,
    dashboard:false,
    weeklyExport:false,
    audit:false
  }
  ,
  // Trial / lock
  trialEndsAt: null,      // epoch ms
  appLocked: false,       // hard lock (trial expired or tamper)
  lockReason: "",
  timeGuard: { maxNow: 0 } // anti-clock-back

};

let db;
let logoutTimer = null;
let modalEl = null;

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const HOURS_OPTIONS = [4,5,6,7,8,9,10,11,12,13];

// business hours (24h clock) 10:00 -> 23:00
const OPEN_MIN = 10 * 60;
const CLOSE_MIN = 23 * 60;

let schedState = { weekKey: null };

function qs(sel){ return document.querySelector(sel); }

function initDB(){
  return new Promise((res)=>{
    const request = indexedDB.open("clockDB", 6);
    request.onupgradeneeded = (e)=>{
      db = e.target.result;
      if(!db.objectStoreNames.contains("employees")) db.createObjectStore("employees", { keyPath:"id" });
      if(!db.objectStoreNames.contains("shifts")) db.createObjectStore("shifts", { keyPath:"shiftId" });
      if(!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath:"key" });
      if(!db.objectStoreNames.contains("schedule")) db.createObjectStore("schedule", { keyPath:"id" });
      if(!db.objectStoreNames.contains("audit")) db.createObjectStore("audit", { keyPath:"id" });
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

function addDaysToWeekKey(weekKey, deltaDays){
  const d = new Date(weekKey + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return weekKeyFromDate(d);
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

function isPastWeek(weekKey){
  const cur = weekKeyFromDate(new Date());
  return String(weekKey) < String(cur);
}

function canEditWeek(weekKey){
  if(!hasPremium("weekLock")) return true;
  if(!isPastWeek(weekKey)) return true;
  return !!state.isOwner;
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


function goHome(){
  pingActivity();
  if(state.isAdmin) return renderAdmin();
  return renderEmployee();
}

function logout(){
  pingActivity();
  state.currentUser = null;
  state.isAdmin = false;
  state.isOwner = false;
  closeModal();
  renderLogin();
}

function triggerImport(){
  pingActivity();
  const f = qs("#importFile");
  if(!f){
    // If input isn't in DOM yet, re-render and try again next tick
    if(state.isAdmin) renderAdmin();
    setTimeout(()=>{ const ff = qs("#importFile"); if(ff) ff.click(); }, 50);
    return;
  }
  f.value = "";
  f.click();
}

function openSettingsModal(){
  pingActivity();
  const nameVal = escapeHTML(state.storeName || "Shop Clock");
  const logoVal = escapeHTML(state.logo || "");
  openModal("Settings", `
    <div class="form">
      <label class="lbl">Store name</label>
      <input class="input" id="set_storeName" value="${nameVal}" placeholder="Shop Clock">
      <label class="lbl" style="margin-top:12px;">Logo URL (optional)</label>
      <input class="input" id="set_logo" value="${logoVal}" placeholder="https://...png">
      <div class="row" style="margin-top:14px; justify-content:flex-end;">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn accent" onclick="saveSettingsFromModal()">Save</button>
      </div>
    </div>
  `);
}


/* ---------- Trial / hard lock ---------- */

function nowMs(){ return Date.now(); }

async function setLockState(locked, reason){
  state.appLocked = !!locked;
  state.lockReason = reason || "";
  await saveSetting("appLocked", state.appLocked);
  await saveSetting("lockReason", state.lockReason);
  try{
    if(window.BroadcastChannel){
      const bc = new BroadcastChannel("shopclock_lock");
      bc.postMessage({ locked: state.appLocked, reason: state.lockReason });
      bc.close();
    }
  }catch(e){}
}

async function enforceTrialAndTamperLock(){
  try{ await loadSettings(); }catch(e){}
  const now = nowMs();

  // anti-clock-back: keep a "max observed time" and lock if time goes backwards a lot
  try{
    const tg = state.timeGuard && typeof state.timeGuard === "object" ? state.timeGuard : { maxNow: 0 };
    const maxNow = typeof tg.maxNow === "number" ? tg.maxNow : 0;
    if(maxNow && now < (maxNow - 2*60*1000)){
      await setLockState(true, "Device time changed");
      await saveSetting("timeGuard", { maxNow });
      return;
    }
    const newMax = Math.max(maxNow || 0, now);
    state.timeGuard = { maxNow: newMax };
    await saveSetting("timeGuard", state.timeGuard);
  }catch(e){}

  // trial expiry hard lock
  if(state.trialEndsAt && typeof state.trialEndsAt === "number" && now >= state.trialEndsAt){
    if(!state.appLocked){
      await setLockState(true, "Trial expired");
    }
  }
}

function startLockWatcher(){
  // broadcast listener
  try{
    if(window.BroadcastChannel){
      const bc = new BroadcastChannel("shopclock_lock");
      bc.onmessage = (ev)=>{
        if(ev && ev.data && typeof ev.data.locked === "boolean"){
          state.appLocked = ev.data.locked;
          state.lockReason = ev.data.reason || state.lockReason;
          if(state.appLocked){
            forceLogoutToLocked();
          }
        }
      };
    }
  }catch(e){}

  // periodic check
  setInterval(async ()=>{
    await enforceTrialAndTamperLock();
    if(state.appLocked && (!state.isAdmin && !state.isOwner)){
      forceLogoutToLocked();
    }
  }, 5000);

  document.addEventListener("visibilitychange", async ()=>{
    if(!document.hidden){
      await enforceTrialAndTamperLock();
      if(state.appLocked && (!state.isAdmin && !state.isOwner)){
        forceLogoutToLocked();
      }
    }
  });
}

function forceLogoutToLocked(){
  state.currentUser = null;
  state.isAdmin = false;
  state.isOwner = false;
  renderLogin();
}

function lockScreenHTML(){
  const msg = state.lockReason ? escapeHTML(state.lockReason) : "Access locked";
  return `
    ${brandHTML("Contact developer")}
    <div class="card">
      <div class="note">This system is locked.</div>
      <div style="margin-top:10px;line-height:1.4;">${msg}</div>
      <div style="margin-top:12px;" class="note">Please contact the developer to re-enable access.</div>
    </div>
  `;
}

async function saveSettingsFromModal(){
  try{
    const storeName = qs("#set_storeName")?.value?.trim() || "Shop Clock";
    const logo = qs("#set_logo")?.value?.trim() || "";
    state.storeName = storeName;
    state.logo = logo;
    await saveSetting("storeName", storeName);
    await saveSetting("logo", logo);
    closeModal();
    renderAdmin();
  }catch(e){
    closeModal();
    renderAdmin();
  }
}

function openAddEmployeeModal(){
  pingActivity();
  openModal("Add Employee", `
    <div class="form">
      <label class="lbl">Name</label>
      <input class="input" id="emp_name" placeholder="Employee name">
      <label class="lbl" style="margin-top:12px;">Employee ID</label>
      <input class="input" id="emp_id" inputmode="numeric" placeholder="1">
      <label class="lbl" style="margin-top:12px;">PIN</label>
      <input class="input" id="emp_pin" inputmode="numeric" placeholder="4 digits">
      <label class="lbl" style="margin-top:12px;">Hourly rate</label>
      <input class="input" id="emp_rate" inputmode="decimal" placeholder="10.00">
      <div class="row" style="margin-top:14px; justify-content:flex-end;">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn accent" onclick="createEmployeeFromModal()">Create</button>
      </div>
    </div>
  `);
}

async function createEmployeeFromModal(){
  const name = (qs("#emp_name")?.value || "").trim();
  const idRaw = (qs("#emp_id")?.value || "").trim();
  const pin = (qs("#emp_pin")?.value || "").trim();
  const rateRaw = (qs("#emp_rate")?.value || "").trim();

  if(!name || !idRaw || !pin){
    openModal("Missing info", `<div class="note">Name, ID, and PIN are required.</div>
      <div class="row" style="margin-top:12px; justify-content:flex-end;">
        <button class="btn accent" onclick="closeModal()">OK</button>
      </div>`);
    return;
  }

  const id = Number(idRaw);
  const rate = Number(rateRaw || "0");
  if(!Number.isFinite(id) || id <= 0){
    openModal("Invalid ID", `<div class="note">Employee ID must be a positive number.</div>
      <div class="row" style="margin-top:12px; justify-content:flex-end;">
        <button class="btn accent" onclick="closeModal()">OK</button>
      </div>`);
    return;
  }

  // prevent duplicate ID or PIN
  const employees = await getAll("employees");
  if(employees.some(e => Number(e.id) === id)){
    openModal("Duplicate ID", `<div class="note">That employee ID already exists.</div>
      <div class="row" style="margin-top:12px; justify-content:flex-end;">
        <button class="btn accent" onclick="closeModal()">OK</button>
      </div>`);
    return;
  }
  if(employees.some(e => String(e.pin) === String(pin))){
    openModal("Duplicate PIN", `<div class="note">That PIN is already assigned to another employee.</div>
      <div class="row" style="margin-top:12px; justify-content:flex-end;">
        <button class="btn accent" onclick="closeModal()">OK</button>
      </div>`);
    return;
  }

  const emp = { id, name, pin, rate: Number.isFinite(rate) ? rate : 0, active:true };
  await save("employees", emp);

  closeModal();
  renderAdmin();
}

function pingActivity(){
  bumpAutoLogout();
}

async function loadSettings(){
  const storeName = await get("settings","storeName");
  const logo = await get("settings","logo");
  const premium = await get("settings","premiumUnlocked");
  const flags = await get("settings","premiumFlags");
  const trialEnds = await get("settings","trialEndsAt");
  const locked = await get("settings","appLocked");
  const lockReason = await get("settings","lockReason");
  const tg = await get("settings","timeGuard");
  if(storeName && typeof storeName.value === "string") state.storeName = storeName.value;
  if(logo && typeof logo.value === "string") state.logo = logo.value;

  const legacy = !!(premium && premium.value === true);
  const f = (flags && typeof flags.value === "object" && flags.value) ? flags.value : null;

  state.premiumUnlocked = legacy || !!f;

  const base = { schedule:false, payroll:false, weekLock:false, dashboard:false, weeklyExport:false, audit:false };

  if(legacy){
    base.schedule = true;
  }
  if(f){
    for(const k of Object.keys(base)){
      if(typeof f[k] === "boolean") base[k] = f[k];
    }
  }

  state.premiumFlags = base;

  if(trialEnds && typeof trialEnds.value === "number") state.trialEndsAt = trialEnds.value;
  if(locked && typeof locked.value === "boolean") state.appLocked = locked.value;
  if(lockReason && typeof lockReason.value === "string") state.lockReason = lockReason.value;
  if(tg && typeof tg.value === "object" && tg.value) state.timeGuard = tg.value;

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

function openExportModal(){
  pingActivity();
  openModal("Export", `
    <div class="note">Choose an export type.</div>
    <div class="row" style="justify-content:center;margin-top:12px;">
      <button class="btn" onclick="exportJSON(); closeModal();">JSON</button>
      <button class="btn" onclick="exportCSV(); closeModal();">CSV</button>
    </div>
  `);
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
  // Row 1: core controls
  const coreRow = `
    <div class="row" style="margin-top:10px; flex-wrap:wrap;">
      <button class="btn ${active==="clock"?"accent":""}" onclick="goHome()">Clock</button>
      ${state.isAdmin ? `<button class="btn" onclick="openAddEmployeeModal()">Add Employee</button>` : ""}
      ${state.isAdmin ? `<button class="btn" onclick="openSettingsModal()">Settings</button>` : ""}
      <button class="btn" onclick="logout()">Log Out</button>
    </div>
  `;

  if(!state.isAdmin){
    const empRow = `
      <div class="row" style="margin-top:10px; flex-wrap:wrap;">
        <button class="btn ${active==="clock"?"accent":""}" onclick="goHome()">Clock</button>
        ${hasPremium("schedule") ? `<button class="btn ${active==="schedule"?"accent":""}" onclick="openSchedule()">Schedule</button>` : ""}
        <button class="btn" onclick="logout()">Log Out</button>
      </div>
    `;
    return empRow;
  }

  // Row 2: business tools (premium tools appear here only when unlocked)
  const businessRow = `
    <div class="row" style="margin-top:10px; flex-wrap:wrap;">
      <button class="btn" onclick="triggerImport()">Import</button>
      <button class="btn" onclick="openExportModal()">Export</button>

      ${hasPremium("schedule") ? `<button class="btn" onclick="openSchedule()">Schedule</button>` : ""}
      ${hasPremium("dashboard") ? `<button class="btn" onclick="openDashboard()">Dashboard</button>` : ""}
      ${hasPremium("payroll") ? `<button class="btn" onclick="openPayroll()">Payroll</button>` : ""}
      ${hasPremium("weeklyExport") ? `<button class="btn" onclick="openWeeklyExport()">Weekly Export</button>` : ""}
      ${hasPremium("audit") ? `<button class="btn" onclick="openAudit()">Audit</button>` : ""}
    </div>
  `;

  // Premium buttons (locked only) - shown ONLY when toggled ON
  const premiumRow = state.showPremiumBar ? `
    <div class="row" style="margin-top:10px; flex-wrap:wrap;">
      ${!hasPremium("schedule") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Schedule')">Schedule</button>` : ""}
      ${!hasPremium("dashboard") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Dashboard')">Dashboard</button>` : ""}
      ${!hasPremium("payroll") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Payroll')">Payroll</button>` : ""}
      ${!hasPremium("weeklyExport") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Weekly Export')">Weekly Export</button>` : ""}
      ${!hasPremium("audit") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Audit')">Audit</button>` : ""}
    </div>
  ` : "";

  // Row 3: toggle (ONLY button on this row, always last)
  const premiumToggle = `
    <div class="row" style="margin-top:10px; justify-content:center;">
      <button class="btn slim" onclick="togglePremiumBar()">
        ${state.showPremiumBar ? "Hide Premium Tools" : "Show Premium Tools"}
      </button>
    </div>
  `;

  return coreRow + businessRow + premiumRow + `<input id="importFile" type="file" style="display:none" onchange="importJSON(event)">` + premiumToggle;
}

function renderPremiumLocked(featureLabel){
  const who = state.isAdmin ? (state.isOwner ? "Admin (Owner)" : "Admin") : `Welcome ${escapeHTML(state.currentUser?.name || "")}!`;
  setAppHTML(`
    ${brandHTML(who)}
    <div class="card">
      <div style="font-weight:800; font-size:16px;">Premium Feature</div>
      <div class="note" style="margin-top:8px;">
        ${escapeHTML(featureLabel || "This feature")} is part of the Premium package.
      </div>
      <div class="note" style="margin-top:8px;">
        If you’d like this enabled, contact the developer.
      </div>
      <div class="row" style="justify-content:center;margin-top:12px;">
        <button class="btn" onclick="${state.isAdmin ? "renderAdmin()" : "renderEmployee()"}">Back</button>
      </div>
    </div>
  `);
}

function hasPremium(featureKey){
  if(state.isOwner) return true;
  return !!(state.premiumFlags && state.premiumFlags[featureKey] === true);
}



function premiumBtnHTML(featureKey, label, onClick){
  const enabled = hasPremium(featureKey);
  const cls = enabled ? "btn" : "btn premium-locked";
  const handler = enabled ? onClick : `renderPremiumLocked("${label}")`;
  return `<button class="${cls}" onclick='${handler}'>${escapeHTML(label)}</button>`;
}


function formatTime12FromHourMin(h, m){
  h = Number(h); m = Number(m);
  const ampm = h >= 12 ? "PM" : "AM";
  let hh = h % 12; if(hh===0) hh = 12;
  return `${hh}:${String(m).padStart(2,"0")} ${ampm}`;
}

function dayLabel(i){
  return ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i] || "";
}

function isoDayFromWeekKey(weekKey, dayIndex){
  const d = new Date(weekKey + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

function defaultDayEntry(){
  return { employeeId: "", hours: 8, slot: "AM" };
}

function normalizeDayAssignments(dayVal){
  // Backwards compatible: object -> [object], null -> []
  if(Array.isArray(dayVal)) return dayVal;
  if(dayVal && typeof dayVal === "object") return [dayVal];
  return [];
}


async function loadSchedule(weekKey){
  const rec = await get("schedule", weekKey);
  if(rec && rec.days){
    // normalize each day to array
    for(let i=0;i<7;i++){
      rec.days[i] = normalizeDayAssignments(rec.days[i]);
      if(rec.days[i].length===0) rec.days[i] = [defaultDayEntry()];
    }
    return rec;
  }
  const days = {};
  for(let i=0;i<7;i++) days[i] = [defaultDayEntry()];
  return { id: weekKey, weekKey, days, createdAt: Date.now(), updatedAt: Date.now() };
}

async function saveSchedule(rec){
  rec.updatedAt = Date.now();
  await save("schedule", rec);
}

function calcAutoTime(hours, slot){
  hours = Math.max(0, Math.min(13, Number(hours)||0));
  // Shop open 10:00, close 23:00
  const OPEN = 10;
  const CLOSE = 23;
  let start = OPEN;
  let end = OPEN + hours;
  if(slot === "PM"){
    end = CLOSE;
    start = Math.max(OPEN, CLOSE - hours);
  }else{
    start = OPEN;
    end = Math.min(CLOSE, OPEN + hours);
  }
  return { startH: start, startM: 0, endH: end, endM: 0 };
}


async function addScheduleRow(dayIndex){
  pingActivity();
  const wk = state.scheduleWeekKey || weekKeyFromDate(new Date());
  const sched = await loadSchedule(wk);
  sched.days[dayIndex] = normalizeDayAssignments(sched.days[dayIndex]);
  sched.days[dayIndex].push(defaultDayEntry());
  await saveSchedule(sched);
  renderScheduleAdminBuilder();
}

async function removeScheduleRow(dayIndex, rowIndex){
  pingActivity();
  const wk = state.scheduleWeekKey || weekKeyFromDate(new Date());
  const sched = await loadSchedule(wk);
  const arr = normalizeDayAssignments(sched.days[dayIndex]);
  arr.splice(rowIndex, 1);
  if(arr.length===0) arr.push(defaultDayEntry());
  sched.days[dayIndex] = arr;
  await saveSchedule(sched);
  renderScheduleAdminBuilder();
}

async function renderScheduleAdminBuilder(){
  pingActivity();
  state.currentView = "schedule";
  const employees = (await getAll("employees")).filter(e=>e && e.active !== false).sort((a,b)=>Number(a.id)-Number(b.id));
  const wk = state.scheduleWeekKey || weekKeyFromDate(new Date());
  state.scheduleWeekKey = wk;

  const sched = await loadSchedule(wk);

  const dayCards = Array.from({length:7}, (_,i)=>{
    const assigns = normalizeDayAssignments(sched.days[i]);
    const rows = assigns.map((entry,j)=>{
      const hours = Number(entry.hours||0);
      const slot = entry.slot || "AM";
      const t = calcAutoTime(hours, slot);
      const timeLabel = `${formatTime12FromHourMin(t.startH,t.startM)} - ${formatTime12FromHourMin(t.endH,t.endM)}`;
      const opts = ['<option value="">—</option>'].concat(
        employees.map(e=>`<option value="${escapeHTML(e.id)}" ${String(e.id)===String(entry.employeeId)?"selected":""}>${escapeHTML(e.name)} (#${escapeHTML(e.id)})</option>`)
      ).join("");
      return `
        <div class="card soft" style="margin-top:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-weight:800;">Employee Slot ${j+1}</div>
            <div class="note">${timeLabel}</div>
          </div>
          <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px;">
  <select class="input" id="sch_emp_${i}_${j}">
    ${opts}
  </select>

  <div style="display:flex; gap:10px;">
    <input class="input" style="flex:1;" id="sch_hours_${i}_${j}" inputmode="numeric" value="${escapeHTML(hours)}" placeholder="Hours">
    <select class="input" style="flex:1;" id="sch_slot_${i}_${j}">
      <option value="AM" ${slot==="AM"?"selected":""}>AM</option>
      <option value="PM" ${slot==="PM"?"selected":""}>PM</option>
    </select>
  </div>

  <button class="btn slim danger" onclick="removeScheduleRow(${i},${j})">Remove Employee</button>
</div>
        </div>
      `;
    }).join("");

    return `
      <div class="card soft" style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div style="font-weight:900;font-size:18px;">${dayLabel(i)} <span class="note" style="font-weight:700;">${isoDayFromWeekKey(wk,i)}</span></div>
          <button class="btn" onclick="addScheduleRow(${i})">+ Add Employee</button>
        </div>
        ${rows}
      </div>
    `;
  }).join("");

  setAppHTML(`
    <div class="wrap">
      ${brandHTML("")}
      ${navBarHTML("schedule")}
      <div class="card soft" style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:900;font-size:18px;">Schedule Builder</div>
            <div class="note">Week starts Monday. Add employees per day, set hours + AM/PM. Times auto-generate using 10AM–11PM.</div>
          </div>
          <div class="row">
            <button class="btn" onclick="changeScheduleWeek(-7)">Prev Week</button>
            <button class="btn" onclick="changeScheduleWeek(7)">Next Week</button>
          </div>
        </div>

        <div class="row" style="margin-top:12px; justify-content:space-between; align-items:center; flex-wrap:wrap;">
          <div class="note"><b>Week:</b> ${escapeHTML(wk)}</div>
          <div class="row">
            <button class="btn" onclick="clearScheduleWeek()">New Schedule</button>
            <button class="btn accent" onclick="saveScheduleWeek()">Save</button>
          </div>
        </div>
      </div>

      ${dayCards}
      <div style="height:18px;"></div>
    </div>
  `);
}

function changeScheduleWeek(deltaDays){
  pingActivity();
  const d = new Date((state.scheduleWeekKey || weekKeyFromDate(new Date())) + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  state.scheduleWeekKey = weekKeyFromDate(d);
  renderScheduleAdminBuilder();
}

async function clearScheduleWeek(){
  pingActivity();
  const wk = state.scheduleWeekKey || weekKeyFromDate(new Date());
  const days = {};
  for(let i=0;i<7;i++) days[i] = [defaultDayEntry()];
  await saveSchedule({ id:wk, weekKey:wk, days, createdAt: Date.now(), updatedAt: Date.now() });
  renderScheduleAdminBuilder();
}

async function saveScheduleWeek(){
  pingActivity();
  const wk = state.scheduleWeekKey || weekKeyFromDate(new Date());
  const sched = await loadSchedule(wk);

  for(let i=0;i<7;i++){
    const empEls = Array.from(document.querySelectorAll(`[id^="sch_emp_${i}_"]`));
    // if none, keep at least one default row
    const rows = [];
    for(const el of empEls){
      const idParts = el.id.split("_");
      const j = Number(idParts[idParts.length-1]);
      const emp = el.value || "";
      const hours = Number(qs(`#sch_hours_${i}_${j}`)?.value || 0);
      const slot = qs(`#sch_slot_${i}_${j}`)?.value || "AM";
      rows.push({ employeeId: emp, hours: Math.max(0, Math.min(13, hours||0)), slot });
    }
    sched.days[i] = rows.length ? rows : [defaultDayEntry()];
  }

  await saveSchedule(sched);
  openModal("Saved", `<div class="note">Schedule saved for week ${escapeHTML(wk)}.</div>
    <div class="row" style="margin-top:12px;justify-content:flex-end;">
      <button class="btn accent" onclick="closeModal()">OK</button>
    </div>`);
}

async function renderScheduleEmployee(){
  pingActivity();
  state.currentView = "schedule";
  const wk = weekKeyFromDate(new Date());
  const sched = await loadSchedule(wk);

  const emp = state.currentUser;
  const empId = emp && (emp.id ?? emp.employeeId);
  const rows = Array.from({length:7}, (_,i)=>{
    const assigns = normalizeDayAssignments(sched.days[i]);
    const mine = assigns.filter(a => String(a.employeeId) === String(empId));
    if(!mine.length) return "";
    const inner = mine.map((a)=>{
      const t = calcAutoTime(a.hours, a.slot);
      const timeLabel = `${formatTime12FromHourMin(t.startH,t.startM)} - ${formatTime12FromHourMin(t.endH,t.endM)}`;
      return `<div class="note" style="margin-top:6px;">${escapeHTML(a.slot)} • ${escapeHTML(a.hours)} hour(s) • ${escapeHTML(timeLabel)}</div>`;
    }).join("");
    return `
      <div class="card soft" style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:900;font-size:18px;">${dayLabel(i)} <span class="note" style="font-weight:700;">${isoDayFromWeekKey(wk,i)}</span></div>
        </div>
        ${inner}
      </div>
    `;
  }).join("");

  setAppHTML(`
    <div class="wrap">
      ${brandHTML("")}
      ${navBarHTML("schedule")}
      <div class="card soft" style="margin-top:12px;">
        <div style="font-weight:900;font-size:18px;">Your Schedule</div>
        <div class="note">Week: ${escapeHTML(wk)}</div>
      </div>
      ${rows || `<div class="card soft" style="margin-top:12px;"><div class="note">No scheduled shifts assigned to you this week.</div></div>`}
      <div style="height:18px;"></div>
    </div>
  `);
}

function openSchedule(){
  pingActivity();
  try{
    if(state.isAdmin) return renderScheduleAdminBuilder();
    return renderScheduleEmployee();
  }catch(e){
    openModal("Schedule Error", `<div class="note">Schedule failed to open.</div>
      <div class="row" style="margin-top:12px;justify-content:flex-end;">
        <button class="btn accent" onclick="closeModal()">OK</button>
      </div>`);
  }
}

async function setPremiumFlags(flagsObj){
  const cur = (state.premiumFlags && typeof state.premiumFlags === "object") ? state.premiumFlags : {};
  const next = { ...cur };
  for(const k of ["schedule","payroll","weekLock","dashboard","weeklyExport","audit"]){
    if(typeof flagsObj[k] === "boolean") next[k] = flagsObj[k];
  }
  await save("settings", { key:"premiumFlags", value: next });
  state.premiumFlags = next;
  state.premiumUnlocked = Object.values(next).some(v=>v===true);
}

function setupDevLongPress(btn){
  let timer = null;
  const start = ()=>{
    timer = setTimeout(()=>{
      timer = null;
      openDevUnlockModal();
    }, 5000);
  };
  const cancel = ()=>{
    if(timer){ clearTimeout(timer); timer = null; }
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointercancel", cancel);
  btn.addEventListener("pointerleave", cancel);
}

function openDevUnlockModal(){
  pingActivity();
  openModal("Developer Panel", `
    <div class="note">Enter developer code to manage Premium features.</div>
    <div style="margin-top:10px;">
      <input class="field" id="devUnlockCode" placeholder="Developer code" inputmode="numeric">
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn accent" onclick="openDevPanel()">Continue</button>
    </div>
  `);
}

async function openDevPanel(){
  pingActivity();
  const code = (qs("#devUnlockCode")?.value || "").trim();
  if(code !== DEV_UNLOCK_CODE) return;

  const f = state.premiumFlags || {};
  openModal("Premium Controls", `
    <div class="note">Toggle features and save.</div>
    <div class="card soft" style="margin-top:12px;">
      <div style="font-weight:800;">Trial / Lock</div>
      <div class="note" style="margin-top:6px;">Set a trial end date/time. After expiry, the app hard-locks for everyone except Admin/Owner + Developer panel.</div>
      <div class="form" style="margin-top:10px;">
        <label class="lbl">Trial ends (local)</label>
        <input class="input" id="trialEndsAtInput" type="datetime-local">
        <div class="row" style="justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn" onclick="setTrialMinutes(5)">+5 min</button>
          <button class="btn" onclick="setTrialHours(24)">+24 hr</button>
          <button class="btn" onclick="setTrialDays(3)">+3 days</button>
          <button class="btn danger" onclick="clearTrial()">Clear</button>
        </div>
        <div class="row" style="justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn accent" onclick="saveTrialEnds()">Save Trial End</button>
          <button class="btn" onclick="restoreBaseAccess()">Restore Base Access</button>
          <button class="btn danger" onclick="hardLockNow()">Lock Now</button>
        </div>
      </div>
    </div>


    <div style="margin-top:12px; display:flex; flex-direction:column; gap:10px;">
      ${devToggleRow("schedule","Schedule Builder", f.schedule)}
      ${devToggleRow("payroll","Payroll Summary", f.payroll)}
      ${devToggleRow("weekLock","Lock Past Weeks", f.weekLock)}
      ${devToggleRow("dashboard","Weekly Dashboard", f.dashboard)}
      ${devToggleRow("weeklyExport","Weekly Export Summary", f.weeklyExport)}
      ${devToggleRow("audit","Audit Log Viewer", f.audit)}
    </div>

    <div class="row" style="justify-content:flex-end;margin-top:14px;">
      <button class="btn danger" onclick="devDisableAll()">Disable All</button>
      <button class="btn accent" onclick="devSaveFlags()">Save</button>
    </div>
  `);
  setTimeout(()=>{ try{ const el = qs("#trialEndsAtInput"); if(el){ const ms = state.trialEndsAt || 0; el.value = ms? isoToLocalInput(new Date(ms).toISOString()) : ""; } }catch(e){} }, 50);

}

async function saveTrialEnds(){
  pingActivity();
  const v = (qs("#trialEndsAtInput")?.value || "").trim();
  if(!v) return;
  const iso = localInputToISO(v);
  if(!iso) return;
  const ms = new Date(iso).getTime();
  state.trialEndsAt = ms;
  await saveSetting("trialEndsAt", ms);
  await setLockState(false, "");
  await enforceTrialAndTamperLock();
  closeModal();
  renderAdmin();
}

function _trialNow(){ return nowMs(); }

async function setTrialMinutes(min){
  pingActivity();
  const ms = _trialNow() + (min*60*1000);
  qs("#trialEndsAtInput").value = isoToLocalInput(new Date(ms).toISOString());
}

async function setTrialHours(hours){
  pingActivity();
  const ms = _trialNow() + (hours*60*60*1000);
  qs("#trialEndsAtInput").value = isoToLocalInput(new Date(ms).toISOString());
}

async function setTrialDays(days){
  pingActivity();
  const ms = _trialNow() + (days*24*60*60*1000);
  qs("#trialEndsAtInput").value = isoToLocalInput(new Date(ms).toISOString());
}

async function clearTrial(){
  pingActivity();
  state.trialEndsAt = null;
  await saveSetting("trialEndsAt", null);
  await setLockState(false, "");
  closeModal();
  renderAdmin();
}

async function hardLockNow(){
  pingActivity();
  await setLockState(true, "Locked by developer");
  closeModal();
  renderLogin();
}

async function restoreBaseAccess(){
  pingActivity();
  // disable premium + unlock app
  state.premiumUnlocked = false;
  state.premiumFlags = { schedule:false, payroll:false, weekLock:false, dashboard:false, weeklyExport:false, audit:false };
  await saveSetting("premiumUnlocked", false);
  await saveSetting("premiumFlags", null);
  await setLockState(false, "");
  closeModal();
  renderAdmin();
}



function devToggleRow(key, label, checked){
  return `
    <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid var(--line); border-radius:14px; background: rgba(0,0,0,.14);">
      <div style="font-weight:700;">${escapeHTML(label)}</div>
      <input type="checkbox" id="flag_${escapeHTML(key)}" ${checked ? "checked" : ""} style="width:22px;height:22px;">
    </label>
  `;
}

async function devDisableAll(){
  pingActivity();
  await setPremiumFlags({ schedule:false, payroll:false, weekLock:false, dashboard:false, weeklyExport:false, audit:false });
  closeModal();
}

async function devSaveFlags(){
  pingActivity();
  const flags = {
    schedule: !!qs("#flag_schedule")?.checked,
    payroll: !!qs("#flag_payroll")?.checked,
    weekLock: !!qs("#flag_weekLock")?.checked,
    dashboard: !!qs("#flag_dashboard")?.checked,
    weeklyExport: !!qs("#flag_weeklyExport")?.checked,
    audit: !!qs("#flag_audit")?.checked
  };
  await setPremiumFlags(flags);
  closeModal();
}

function togglePremiumBar(){
  pingActivity();
  state.showPremiumBar = !state.showPremiumBar;
  // Re-render current view without relying on tab switching
  if(state.isAdmin){
    // try to keep user in the same admin section if possible
    const current = state.currentView || "admin";
    if(current === "dashboard") return renderDashboard();
    if(current === "payroll") return renderPayroll();
    if(current === "weeklyExport") return renderWeeklyExport();
    if(current === "audit") return renderAudit();
    if(current === "schedule") return openSchedule();
    return renderAdmin();
  }
  return renderEmployee();
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

async function ensureAuditStore(){
  return new Promise((resolve) => {
    const req = indexedDB.open("clockDB");
    req.onsuccess = function(){
      const db = req.result;
      if(!db.objectStoreNames.contains("audit")){
        db.close();
        const upgrade = indexedDB.open("clockDB", 6);
        upgrade.onupgradeneeded = function(e){
          const db2 = e.target.result;
          if(!db2.objectStoreNames.contains("audit")){
            db2.createObjectStore("audit", { keyPath: "id" });
          }
        };
        upgrade.onsuccess = function(){ resolve(); };
      } else {
        resolve();
      }
    };
  });
}


async function addAudit(entry){
  await ensureAuditStore();
  const rec = {
    id: Date.now().toString() + "_" + Math.random().toString(16).slice(2),
    at: new Date().toISOString(),
    ...entry
  };
  await save("audit", rec);
}

async function getAuditByWeek(weekKey){
  const all = await getAll("audit");
  return all
    .filter(x => x && x.weekKey === weekKey)
    .sort((a,b)=> new Date(b.at).getTime() - new Date(a.at).getTime());
}



/* ---------- Persistence hardening ---------- */

async function requestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      await navigator.storage.persist();
    }
  }catch(e){}
}

/* ---------- Clock features ---------- */


function flashPinError(){
  const d = qs("#pinDisplay");
  if(!d) return;
  d.textContent = "Invalid PIN";
  d.classList.add("pinError");
  setTimeout(()=>{ 
    d.classList.remove("pinError");
    d.textContent = "";
  }, 900);
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
      else if(k==="OK"){ try{ const ok = await handleLogin(pin); if(!ok){ flashPinError(); } }catch(e){ flashPinError(); } pin=""; }
      else { pin += String(k); }
      display.textContent = pin ? "•".repeat(pin.length) : "";
    };
    pad.appendChild(b);
    if(k===5) setupDevLongPress(b);
  });
}

async function handleLogin(pin){
  pin = String(pin || "").trim();

  try{
    await loadSettings();
  }catch(e){
    // If storage is blocked, still allow admin/owner login
  }


  // If app is hard-locked, only Admin/Owner PINs can enter (to restore via dev panel)
  if(state.appLocked && pin !== ADMIN_PIN && pin !== OWNER_PIN){
    setAppHTML(lockScreenHTML());
    return false;
  }
  if(pin === ADMIN_PIN){
    state.currentUser = "admin";
    state.isAdmin = true;
    state.isOwner = false;
    renderAdmin();
    return true;
  }

  if(pin === OWNER_PIN){
    state.currentUser = "owner";
    state.isAdmin = true;
    state.isOwner = true;
    renderAdmin();
    return true;
  }

  try{
    const employees = await getAll("employees");
    const user = employees.find(e => e.pin === pin && e.active !== false);
    if(user){
      state.currentUser = user;
      state.isAdmin = false;
      state.isOwner = false;
      renderEmployee();
      return true;
    }
  }catch(e){
    // fallthrough
  }

  return false;
}


async function renderAdmin(){
  if(state.appLocked && !(state.isAdmin || state.isOwner)) { setAppHTML(lockScreenHTML()); return; }

  pingActivity();
  state.currentView = "admin";
  state.currentView = "admin";
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
      const lockedShift = !canEditWeek(weekKeyFromDate(new Date(s.in)));
      const buttonsHTML = lockedShift ? `<span class="badge gold">Locked</span>` : `
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn slim" onclick="editShift('${s.shiftId}')">Edit</button>
            <button class="btn slim danger" onclick="deleteShift('${s.shiftId}')">Delete</button>
          </div>`;

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
          ${buttonsHTML}
        </div>
      `;
      recentList.appendChild(row);
    }
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


async function editShift(shiftId){
  pingActivity();
  if(!state.isAdmin && !state.isOwner) return;

  const shift = await get("shifts", shiftId);
  if(!shift) return;

  const beforeIn = shift.in;
  const beforeOut = shift.out;

  const inLocal = isoToLocalInput(shift.in);
  const outLocal = shift.out ? isoToLocalInput(shift.out) : "";

  openModal("Edit Shift", `
    <div class="form">
      <label class="lbl">Clock In</label>
      <input class="input" id="edit_in" type="datetime-local" value="${escapeAttr(inLocal)}">
      <label class="lbl" style="margin-top:12px;">Clock Out</label>
      <input class="input" id="edit_out" type="datetime-local" value="${escapeAttr(outLocal)}">
      <div class="note" style="margin-top:10px;">Leave Clock Out empty to keep shift open.</div>
      <div class="row" style="justify-content:flex-end;margin-top:14px;gap:10px;">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn accent" onclick="saveEditedShift('${shiftId}')">Save</button>
      </div>
    </div>
  `);
}

async function saveEditedShift(shiftId){
  pingActivity();
  if(!state.isAdmin && !state.isOwner) return;

  const shift = await get("shifts", shiftId);
  if(!shift) return;

  const emp = await get("employees", shift.employeeId);
  const employeeName = emp ? emp.name : "";

  const beforeIn = shift.in;
  const beforeOut = shift.out;

  const newIn = localInputToISO(qs("#edit_in")?.value || "");
  const newOutRaw = (qs("#edit_out")?.value || "").trim();
  const newOut = newOutRaw ? localInputToISO(newOutRaw) : null;

  if(!newIn){ closeModal(); return; }

  shift.in = newIn;
  shift.out = newOut;
  await save("shifts", shift);

  // compute hour delta for the shift only
  const beforeH = calcShiftHoursISO(beforeIn, beforeOut);
  const afterH = calcShiftHoursISO(newIn, newOut);
  const diff = (afterH - beforeH);
  const diffStr = (diff>=0?"+":"") + diff.toFixed(2) + " hr";

  const dateStr = fmtDateLocal(newIn);
  const beforeLine = `Before\n> In: ${fmtTimeLocal12(beforeIn)}\n> Out: ${beforeOut?fmtTimeLocal12(beforeOut):"—"}`;
  const afterLine  = `After\n> In: ${fmtTimeLocal12(newIn)}\n> Out: ${newOut?fmtTimeLocal12(newOut):"—"}`;
  const details = `Employee\n> ${employeeName} ${shift.employeeId}\nDate\n${dateStr}\n${beforeLine}\n${afterLine}\nHours Difference\n> ${diffStr}`;

  await addAudit({
    type:"Shift Edited",
    actor: state.isOwner ? "Owner" : "Admin",
    employeeId: shift.employeeId,
    employeeName,
    shiftId,
    weekKey: weekKeyFromISO(newIn),
    details
  });

  await sendWebhook({
    content: `**Shift Edited**\n${details.replace(/\n/g,"\n")}`
  });

  closeModal();
  renderAdmin();
}

async function deleteShift(shiftId){
  pingActivity();
  if(!state.isAdmin && !state.isOwner) return;

  const shift = await get("shifts", shiftId);
  if(!shift) return;

  const emp = await get("employees", shift.employeeId);
  const employeeName = emp ? emp.name : "";

  openModal("Delete Shift", `
    <div class="note">This cannot be undone.</div>
    <div class="card soft" style="margin-top:12px;">
      <div><strong>In:</strong> ${fmtDateTimeLocal(shift.in)}</div>
      <div><strong>Out:</strong> ${shift.out?fmtDateTimeLocal(shift.out):"—"}</div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:14px;gap:10px;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn danger" onclick="confirmDeleteShift('${shiftId}')">Delete</button>
    </div>
  `);
}

async function confirmDeleteShift(shiftId){
  pingActivity();
  if(!state.isAdmin && !state.isOwner) return;

  const shift = await get("shifts", shiftId);
  if(!shift) return;

  const emp = await get("employees", shift.employeeId);
  const employeeName = emp ? emp.name : "";

  // delete
  await del("shifts", shiftId);

  const hours = calcShiftHoursISO(shift.in, shift.out);
  const details = `Employee\n> ${employeeName} ${shift.employeeId}\nDate\n${fmtDateLocal(shift.in)}\nShift\n> In: ${fmtTimeLocal12(shift.in)}\n> Out: ${shift.out?fmtTimeLocal12(shift.out):"—"}\nHours Removed\n> -${hours.toFixed(2)} hr`;

  await addAudit({
    type:"Shift Deleted",
    actor: state.isOwner ? "Owner" : "Admin",
    employeeId: shift.employeeId,
    employeeName,
    shiftId,
    weekKey: weekKeyFromISO(shift.in),
    details
  });

  await sendWebhook({ content: `**Shift Deleted**\n${details}` });

  closeModal();
  renderAdmin();
}

function calcShiftHoursISO(inISO, outISO){
  if(!inISO || !outISO) return 0;
  const a = new Date(inISO).getTime();
  const b = new Date(outISO).getTime();
  if(!isFinite(a) || !isFinite(b) || b<=a) return 0;
  return (b-a)/3600000;
}

function isoToLocalInput(iso){
  try{
    const d = new Date(iso);
    if(!isFinite(d.getTime())) return "";
    const pad = (n)=> String(n).padStart(2,"0");
    const y = d.getFullYear();
    const m = pad(d.getMonth()+1);
    const da = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${y}-${m}-${da}T${hh}:${mm}`;
  }catch(e){ return ""; }
}

function localInputToISO(v){
  v = String(v||"").trim();
  if(!v) return null;
  // value like 2026-02-27T09:15
  const d = new Date(v);
  if(!isFinite(d.getTime())) return null;
  return d.toISOString();
}

function escapeAttr(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

window.editShift = editShift;
window.deleteShift = deleteShift;
window.saveEditedShift = saveEditedShift;
window.confirmDeleteShift = confirmDeleteShift;

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
  if(state.appLocked && !(state.isAdmin || state.isOwner)) { setAppHTML(lockScreenHTML()); return; }

  pingActivity();
  state.currentView = "employee";
  state.currentView = "employee";
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

function premiumOrLocked(key, label, renderFn){
  pingActivity();
  if(!hasPremium(key)){
    renderPremiumLocked(label);
    return;
  }
  renderFn();
}

function openDashboard(){ premiumOrLocked("dashboard","Weekly Dashboard", renderDashboard); }
function openPayroll(){ premiumOrLocked("payroll","Payroll Summary", renderPayroll); }
function openWeeklyExport(){ premiumOrLocked("weeklyExport","Weekly Export Summary", renderWeeklyExport); }
function openAudit(){ premiumOrLocked("audit","Audit Log Viewer", renderAudit); }

function barHTML(pct){
  const p = Math.max(0, Math.min(100, pct));
  return `<div style="height:10px; border-radius:999px; background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); overflow:hidden;">
    <div style="height:100%; width:${p}%; background: linear-gradient(90deg, rgba(124,92,255,.55), rgba(46,204,113,.45)); box-shadow: 0 0 18px var(--glow);"></div>
  </div>`;
}

async function computeWeekStats(weekKey){
  const employees = (await getAll("employees")).filter(e=>e.active!==false);
  const shifts = await getAll("shifts");
  const rows = [];

  for(const e of employees){
    const wkShifts = shifts.filter(s => s.employeeId === e.id && s.out && weekKeyFromDate(new Date(s.in)) === weekKey);
    let hours = 0;
    for(const s of wkShifts) hours += hoursBetween(s.in, s.out);
    const rate = Number(e.rate || 0);
    const pay = hours * rate;
    rows.push({ id:e.id, name:e.name, rate, shifts:wkShifts.length, hours, pay });
  }

  rows.sort((a,b)=> b.hours - a.hours);
  const totalHours = rows.reduce((n,r)=> n + r.hours, 0);
  const totalPay = rows.reduce((n,r)=> n + r.pay, 0);
  return { rows, totalHours, totalPay };
}

async function renderDashboard(){
  pingActivity();
  state.currentView = "dashboard";
  state.currentView = "dashboard";
  await loadSettings();

  const weekKey = weekKeyFromDate(new Date());
  const stats = await computeWeekStats(weekKey);
  const maxHours = Math.max(1, ...stats.rows.map(r=>r.hours));

  setAppHTML(`
    ${brandHTML(state.isOwner ? "Admin (Owner) — Dashboard" : "Admin — Dashboard")}
    ${navBarHTML("clock")}
    <div class="card">
      <div style="font-weight:800;">This Week</div>
      <div class="note">${weekLabel(weekKey)}</div>
      <div class="kpi" style="justify-content:flex-start;margin-top:10px;">
        <div class="pill"><strong>Total Hours</strong>&nbsp;&nbsp;${stats.totalHours.toFixed(2)}</div>
        <div class="pill"><strong>Labor Cost</strong>&nbsp;&nbsp;$${stats.totalPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="list">
      ${stats.rows.map(r=>{
        const pct = (r.hours / maxHours) * 100;
        return `
          <div class="card">
            <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
              <div>
                <div style="font-weight:800;">${escapeHTML(r.name)} <span class="badge">${escapeHTML(r.id)}</span></div>
                <div class="note">${r.shifts} shift(s) • $${r.rate.toFixed(2)}/hr</div>
              </div>
              <div style="text-align:right;">
                <div style="font-weight:800;">${r.hours.toFixed(2)} hrs</div>
                <div class="note">$${r.pay.toFixed(2)}</div>
              </div>
            </div>
            <div style="margin-top:10px;">${barHTML(pct)}</div>
          </div>
        `;
      }).join("") || `<div class="card soft"><div class="note">No data yet.</div></div>`}
    </div>
  `);
}

let payrollWeekKey = null;
function payrollPrevWeek(){ payrollWeekKey = addDaysToWeekKey(payrollWeekKey, -7); renderPayroll(); }
function payrollNextWeek(){ payrollWeekKey = addDaysToWeekKey(payrollWeekKey,  7); renderPayroll(); }
function payrollThisWeek(){ payrollWeekKey = weekKeyFromDate(new Date()); renderPayroll(); }

async function renderPayroll(){
  pingActivity();
  state.currentView = "payroll";
  state.currentView = "payroll";
  await loadSettings();

  if(!payrollWeekKey) payrollWeekKey = weekKeyFromDate(new Date());
  const weekKey = payrollWeekKey;

  const stats = await computeWeekStats(weekKey);

  setAppHTML(`
    ${brandHTML(state.isOwner ? "Admin (Owner) — Payroll" : "Admin — Payroll")}
    ${navBarHTML("clock")}

    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <button class="btn slim" onclick="payrollPrevWeek()">◀ Prev</button>
        <div style="text-align:center;">
          <div style="font-weight:800;">Payroll Week</div>
          <div class="note">${weekLabel(weekKey)}</div>
        </div>
        <button class="btn slim" onclick="payrollNextWeek()">Next ▶</button>
      </div>
      <div class="row" style="justify-content:center;margin-top:10px;">
        <button class="btn slim" onclick="payrollThisWeek()">This Week</button>
      </div>
      <div class="kpi" style="justify-content:flex-start;margin-top:10px;">
        <div class="pill"><strong>Total Hours</strong>&nbsp;&nbsp;${stats.totalHours.toFixed(2)}</div>
        <div class="pill"><strong>Total Pay</strong>&nbsp;&nbsp;$${stats.totalPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="card" style="overflow:auto;">
      <table style="width:100%; border-collapse:collapse; min-width:760px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Employee</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Rate</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Shifts</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Hours</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Pay</th>
          </tr>
        </thead>
        <tbody>
          ${stats.rows.map(r=>`
            <tr>
              <td style="padding:10px;border-bottom:1px solid var(--line);">
                <div style="font-weight:800;">${escapeHTML(r.name)}</div>
                <div class="note">${escapeHTML(r.id)}</div>
              </td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right;">$${r.rate.toFixed(2)}</td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right;">${r.shifts}</td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right;">${r.hours.toFixed(2)}</td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right; font-weight:800;">$${r.pay.toFixed(2)}</td>
            </tr>
          `).join("") || `<tr><td colspan="5" style="padding:10px;"><div class="note">No shifts in this week.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `);
}

let exportWeekKey = null;
function exportPrevWeek(){ exportWeekKey = addDaysToWeekKey(exportWeekKey, -7); renderWeeklyExport(); }
function exportNextWeek(){ exportWeekKey = addDaysToWeekKey(exportWeekKey,  7); renderWeeklyExport(); }
function exportThisWeek(){ exportWeekKey = weekKeyFromDate(new Date()); renderWeeklyExport(); }

async function downloadWeeklySummaryCSV(weekKey){
  pingActivity();
  const stats = await computeWeekStats(weekKey);

  let csv = "week,employee_name,employee_id,rate,shifts,hours,pay\n";
  for(const r of stats.rows){
    csv += `${weekKey},"${String(r.name).replaceAll('"','""')}",${String(r.id).replaceAll(","," ")},${r.rate.toFixed(2)},${r.shifts},${r.hours.toFixed(2)},${r.pay.toFixed(2)}\n`;
  }

  const blob = new Blob([csv], { type:"text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `weekly_summary_${weekKey}.csv`;
  a.click();
}

async function renderWeeklyExport(){
  pingActivity();
  state.currentView = "weeklyExport";
  state.currentView = "weeklyExport";
  await loadSettings();

  if(!exportWeekKey) exportWeekKey = weekKeyFromDate(new Date());
  const weekKey = exportWeekKey;

  const stats = await computeWeekStats(weekKey);

  setAppHTML(`
    ${brandHTML(state.isOwner ? "Admin (Owner) — Weekly Export" : "Admin — Weekly Export")}
    ${navBarHTML("clock")}

    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <button class="btn slim" onclick="exportPrevWeek()">◀ Prev</button>
        <div style="text-align:center;">
          <div style="font-weight:800;">Week</div>
          <div class="note">${weekLabel(weekKey)}</div>
        </div>
        <button class="btn slim" onclick="exportNextWeek()">Next ▶</button>
      </div>

      <div class="row" style="justify-content:center;margin-top:10px;">
        <button class="btn slim" onclick="exportThisWeek()">This Week</button>
        <button class="btn accent" onclick="downloadWeeklySummaryCSV('${weekKey}')">Download Summary CSV</button>
      </div>

      <div class="kpi" style="justify-content:flex-start;margin-top:10px;">
        <div class="pill"><strong>Total Hours</strong>&nbsp;&nbsp;${stats.totalHours.toFixed(2)}</div>
        <div class="pill"><strong>Total Pay</strong>&nbsp;&nbsp;$${stats.totalPay.toFixed(2)}</div>
      </div>
    </div>

    <div class="card" style="overflow:auto;">
      <table style="width:100%; border-collapse:collapse; min-width:760px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Employee</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Shifts</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Hours</th>
            <th style="text-align:right;padding:10px;border-bottom:1px solid var(--line);">Pay</th>
          </tr>
        </thead>
        <tbody>
          ${stats.rows.map(r=>`
            <tr>
              <td style="padding:10px;border-bottom:1px solid var(--line);">
                <div style="font-weight:800;">${escapeHTML(r.name)}</div>
                <div class="note">${escapeHTML(r.id)} • $${r.rate.toFixed(2)}/hr</div>
              </td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right;">${r.shifts}</td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right;">${r.hours.toFixed(2)}</td>
              <td style="padding:10px;border-bottom:1px solid var(--line); text-align:right; font-weight:800;">$${r.pay.toFixed(2)}</td>
            </tr>
          `).join("") || `<tr><td colspan="4" style="padding:10px;"><div class="note">No shifts in this week.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `);
}

let auditWeekKey = null;
function auditPrevWeek(){ auditWeekKey = addDaysToWeekKey(auditWeekKey, -7); renderAudit(); }
function auditNextWeek(){ auditWeekKey = addDaysToWeekKey(auditWeekKey,  7); renderAudit(); }
function auditThisWeek(){ auditWeekKey = weekKeyFromDate(new Date()); renderAudit(); }

async function renderAudit(){
  pingActivity();
  state.currentView = "audit";
  state.currentView = "audit";
  await loadSettings();

  if(!auditWeekKey) auditWeekKey = weekKeyFromDate(new Date());
  const weekKey = auditWeekKey;

  const items = await getAuditByWeek(weekKey);

  setAppHTML(`
    ${brandHTML(state.isOwner ? "Admin (Owner) — Audit" : "Admin — Audit")}
    ${navBarHTML("clock")}

    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <button class="btn slim" onclick="auditPrevWeek()">◀ Prev</button>
        <div style="text-align:center;">
          <div style="font-weight:800;">Audit Week</div>
          <div class="note">${weekLabel(weekKey)}</div>
        </div>
        <button class="btn slim" onclick="auditNextWeek()">Next ▶</button>
      </div>
      <div class="row" style="justify-content:center;margin-top:10px;">
        <button class="btn slim" onclick="auditThisWeek()">This Week</button>
      </div>
    </div>

    <div class="list">
      ${items.map(x=>`
        <div class="card">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:800;">${escapeHTML(x.type || "Event")}</div>
              <div class="note">${escapeHTML(x.actor || "")} • ${fmtTimeLocal12(x.at)} • ${fmtDateLocal(x.at)}</div>
            </div>
            <div class="badge glow">${escapeHTML(x.employeeName || x.employeeId || "")}</div>
          </div>
          ${x.details ? `<div class="note" style="margin-top:10px; white-space:pre-line;">${escapeHTML(x.details)}</div>` : ""}
        </div>
      `).join("") || `<div class="card soft"><div class="note">No audit events for this week.</div></div>`}
    </div>
  `);
}

initDB().then(async ()=>{
  await requestPersistentStorage();
  await loadSettings();
  await enforceTrialAndTamperLock();
  startLockWatcher();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  setInterval(autoCloseAt1130, 30000);
  renderLogin();
});
