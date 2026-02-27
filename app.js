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
  premiumFlags: {
    schedule:false,
    payroll:false,
    weekLock:false,
    dashboard:false,
    weeklyExport:false,
    audit:false
  }
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
    const request = indexedDB.open("clockDB", 4);
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

function pingActivity(){
  bumpAutoLogout();
}

async function loadSettings(){
  const storeName = await get("settings","storeName");
  const logo = await get("settings","logo");
  const premium = await get("settings","premiumUnlocked");
  const flags = await get("settings","premiumFlags");
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
      ${premiumBtnHTML("schedule","Schedule","openSchedule()")}
      <button class="btn" onclick="renderLogin()">Log Out</button>
    </div>
  `;
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
  return !!(state.premiumFlags && state.premiumFlags[featureKey] === true);
}


function premiumBtnHTML(featureKey, label, onClick){
  const enabled = hasPremium(featureKey);
  const cls = enabled ? "btn" : "btn premium-locked";
  const handler = enabled ? onClick : `renderPremiumLocked("${label}")`;
  return `<button class="${cls}" onclick='${handler}'>${escapeHTML(label)}</button>`;
}


function openSchedule(){
  pingActivity();
  if(!hasPremium("schedule")){
    renderPremiumLocked("Scheduling");
    return;
  }
  if(state.isAdmin){
    renderScheduleAdminBuilder();
  }else{
    renderScheduleEmployee();
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
async function addAudit(entry){
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
    if(k===5) setupDevLongPress(b);
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

/* ---------- Admin / employee management ---------- */

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

/* ---------- Shift editing / deletion (webhooked) ---------- */

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

  await addAudit({
    weekKey: weekKeyFromDate(new Date(shift.in)),
    type: "Shift Edited",
    actor: state.isOwner ? "Owner" : "Admin",
    employeeId: shift.employeeId,
    employeeName: empInfo.name,
    details: `Employee\n> ${empInfo.name} (${empInfo.id})\nDate\n${dateStr}\nBefore\n> In: ${fmtTimeLocal12(beforeIn)}\n> Out: ${fmtTimeLocal12(beforeOut)}\nAfter\n> In: ${fmtTimeLocal12(shift.in)}\n> Out: ${fmtTimeLocal12(shift.out)}\nHours Difference\n> ${fmtHoursDeltaWords(diffHours)}`
  });

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

  await addAudit({
    weekKey: weekKeyFromDate(new Date(shift.in)),
    type: "Shift Edited",
    actor: state.isOwner ? "Owner" : "Admin",
    employeeId: shift.employeeId,
    employeeName: empInfo.name,
    details: `Employee\n> ${empInfo.name} (${empInfo.id})\nDate\n${dateStr}\nBefore\n> In: ${fmtTimeLocal12(beforeIn)}\n> Out: ${fmtTimeLocal12(beforeOut)}\nAfter\n> In: ${fmtTimeLocal12(shift.in)}\n> Out: ${fmtTimeLocal12(shift.out)}\nHours Difference\n> ${fmtHoursDeltaWords(diffHours)}`
  });
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

/* ---------- Export / Import ---------- */

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
  const audit = await getAll("audit");
  const data = { employees, shifts, settings, schedule, audit };

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
    if(Array.isArray(data.audit)) for(const x of data.audit) await save("audit", x);
    await loadSettings();
    renderAdmin();
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* ---------- Schedule Builder ---------- */
/*
Data model (one employee per day, per week):
id = `${weekKey}|${dayIndex}`

{
  id, weekKey, dayIndex,
  employeeId: "EMP1" or "" (Off),
  hours: 8,
  period: "AM" | "PM",
  start: "10:00",
  end: "18:00",
  updatedAt: ISO
}
*/

function pad2(n){ return String(n).padStart(2,"0"); }

function minsToHHMM(mins){
  const h = Math.floor(mins/60);
  const m = mins%60;
  return `${pad2(h)}:${pad2(m)}`;
}

function hhmmToMins(hhmm){
  const m = String(hhmm||"").match(/^(\d{2}):(\d{2})$/);
  if(!m) return null;
  const h = parseInt(m[1],10);
  const mi = parseInt(m[2],10);
  if(!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  return h*60 + mi;
}

function hhmmTo12(hhmm){
  const mins = hhmmToMins(hhmm);
  if(mins == null) return "--";
  let h = Math.floor(mins/60);
  const m = pad2(mins%60);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if(h===0) h=12;
  return `${h}:${m} ${ampm}`;
}

function computeShift(hours, period){
  const h = Math.max(0, Math.min(13, parseInt(hours,10) || 0));
  if(period === "PM"){
    const end = CLOSE_MIN;
    const start = Math.max(OPEN_MIN, end - h*60);
    return { start: minsToHHMM(start), end: minsToHHMM(end) };
  }
  // AM default
  const start = OPEN_MIN;
  const end = Math.min(CLOSE_MIN, start + h*60);
  return { start: minsToHHMM(start), end: minsToHHMM(end) };
}

function schedKey(weekKey, dayIndex){
  return `${weekKey}|${dayIndex}`;
}

async function getScheduleWeekMap(weekKey){
  const all = await getAll("schedule");
  const map = {};
  for(const x of all){
    if(x && x.weekKey === weekKey && Number.isInteger(x.dayIndex) && x.dayIndex>=0 && x.dayIndex<=6){
      map[x.dayIndex] = x;
    } else if(x && typeof x.id === "string" && x.id.startsWith(weekKey + "|")){
      // tolerate older shapes that still use this id scheme
      const parts = x.id.split("|");
      if(parts.length === 2){
        const di = parseInt(parts[1],10);
        if(di>=0 && di<=6) map[di] = x;
      }
    }
  }
  return map;
}

async function setScheduleDay(weekKey, dayIndex, employeeId, hours, period){
  const empId = String(employeeId || "");
  const hrs = parseInt(hours,10) || 8;
  const per = period === "PM" ? "PM" : "AM";

  if(!empId){
    // Off: delete record
    await del("schedule", schedKey(weekKey, dayIndex));
    await addAudit({
      weekKey,
      type: "Schedule Cleared",
      actor: state.isOwner ? "Owner" : "Admin",
      employeeId: "",
      employeeName: "",
      details: `${DAYS[dayIndex]}\n> Off`
    });
    return;
  }

  const shift = computeShift(hrs, per);
  const rec = {
    id: schedKey(weekKey, dayIndex),
    weekKey,
    dayIndex,
    employeeId: empId,
    hours: hrs,
    period: per,
    start: shift.start,
    end: shift.end,
    updatedAt: new Date().toISOString()
  };
  await save("schedule", rec);

  const emp = await get("employees", empId);
  await addAudit({
    weekKey,
    type: "Schedule Updated",
    actor: state.isOwner ? "Owner" : "Admin",
    employeeId: empId,
    employeeName: emp ? emp.name : empId,
    details: `${DAYS[dayIndex]}\n> ${emp ? emp.name : empId} (${empId})\nShift\n> ${hhmmTo12(rec.start)} – ${hhmmTo12(rec.end)} (${rec.hours} hrs ${rec.period})`
  });
}

async function clearScheduleWeek(weekKey){
  const all = await getAll("schedule");
  for(const x of all){
    if(x && x.weekKey === weekKey){
      await del("schedule", x.id);
    } else if(x && typeof x.id === "string" && x.id.startsWith(weekKey + "|")){
      await del("schedule", x.id);
    }
  }
}

async function copyScheduleWeek(fromWeekKey, toWeekKey){
  await clearScheduleWeek(toWeekKey);
  const fromMap = await getScheduleWeekMap(fromWeekKey);
  for(const di of Object.keys(fromMap)){
    const dayIndex = parseInt(di,10);
    const x = fromMap[dayIndex];
    if(x && x.employeeId){
      await setScheduleDay(toWeekKey, dayIndex, x.employeeId, x.hours || 8, x.period || "AM");
    }
  }
}

function schedulePrevWeek(){ schedState.weekKey = addDaysToWeekKey(schedState.weekKey, -7); renderScheduleAdminBuilder(); }
function scheduleNextWeek(){ schedState.weekKey = addDaysToWeekKey(schedState.weekKey,  7); renderScheduleAdminBuilder(); }
function scheduleThisWeek(){ schedState.weekKey = weekKeyFromDate(new Date()); renderScheduleAdminBuilder(); }

async function scheduleCopyLastWeek(){
  pingActivity();
  const from = addDaysToWeekKey(schedState.weekKey, -7);
  await copyScheduleWeek(from, schedState.weekKey);
  renderScheduleAdminBuilder();
}

async function scheduleClearWeek(){
  pingActivity();
  await clearScheduleWeek(schedState.weekKey);
  renderScheduleAdminBuilder();
}

async function scheduleDayChanged(dayIndex){
  pingActivity();
  const weekKey = schedState.weekKey;
  if(!canEditWeek(weekKey)) return;
  const locked = !canEditWeek(weekKey);
  const emp = qs(`#sched_emp_${dayIndex}`)?.value || "";
  const hrs = qs(`#sched_hrs_${dayIndex}`)?.value || "8";
  const per = qs(`#sched_per_${dayIndex}`)?.value || "AM";

  await setScheduleDay(weekKey, dayIndex, emp, hrs, per);
  renderScheduleAdminBuilder();
}

async function renderScheduleAdminBuilder(){
  pingActivity();
  await loadSettings();

  if(!schedState.weekKey) schedState.weekKey = weekKeyFromDate(new Date());
  const weekKey = schedState.weekKey;
  const locked = !canEditWeek(weekKey);

  const employees = (await getAll("employees"))
    .filter(e => e.active !== false)
    .sort((a,b)=> String(a.name||"").localeCompare(String(b.name||"")));

  const weekMap = await getScheduleWeekMap(weekKey);

  setAppHTML(`
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
        <button class="btn slim" onclick="scheduleCopyLastWeek()" ${locked ? "disabled style=\"opacity:.5;pointer-events:none;\"" : ""}>Copy Last Week</button>
        <button class="btn slim danger" onclick="scheduleClearWeek()" ${locked ? "disabled style=\"opacity:.5;pointer-events:none;\"" : ""}>Clear Week</button>
      </div>

      <div class="note" style="margin-top:10px;">
        Pick an employee, hours, and AM/PM. It auto-builds a shift inside shop hours (10:00 AM – 11:00 PM).${locked ? `<br><br><span class="badge glow">Locked</span> <span class="note">Past weeks can only be edited by Owner.</span>` : ""}
      </div>
    </div>

    <div class="list" id="schedDays"></div>
  `);

  const wrap = qs("#schedDays");

  for(let dayIndex=0; dayIndex<7; dayIndex++){
    const rec = weekMap[dayIndex] || null;
    const employeeId = rec?.employeeId || "";
    const hours = rec?.hours || 8;
    const period = rec?.period || "AM";
    const shift = employeeId ? computeShift(hours, period) : null;
    const preview = employeeId ? `${hhmmTo12(shift.start)} – ${hhmmTo12(shift.end)}` : "Off";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800; font-size:16px;">${DAYS[dayIndex]}</div>
          <div class="note">${preview}</div>
        </div>
        <div class="badge ${employeeId ? "glow" : ""}">${employeeId ? "Scheduled" : "Off"}</div>
      </div>

      <div class="grid2" style="margin-top:12px;">
        <div>
          <div class="note">Employee</div>
          <select class="field" id="sched_emp_${dayIndex}" onchange="scheduleDayChanged(${dayIndex})" ${locked ? "disabled" : ""}>
            <option value="">Off</option>
            ${employees.map(e=>`<option value="${escapeHTML(e.id)}" ${e.id===employeeId?"selected":""}>${escapeHTML(e.name)} (${escapeHTML(e.id)})</option>`).join("")}
          </select>
        </div>

        <div>
          <div class="note">Hours</div>
          <select class="field" id="sched_hrs_${dayIndex}" onchange="scheduleDayChanged(${dayIndex})" ${employeeId ? "" : "disabled"}>
            ${HOURS_OPTIONS.map(h=>`<option value="${h}" ${h===hours?"selected":""}>${h}</option>`).join("")}
          </select>
        </div>

        <div>
          <div class="note">AM / PM</div>
          <select class="field" id="sched_per_${dayIndex}" onchange="scheduleDayChanged(${dayIndex})" ${employeeId ? "" : "disabled"}>
            <option value="AM" ${period==="AM"?"selected":""}>AM (start 10:00)</option>
            <option value="PM" ${period==="PM"?"selected":""}>PM (end 11:00)</option>
          </select>
        </div>

        <div>
          <div class="note">Auto shift</div>
          <div class="field" style="display:flex; align-items:center; justify-content:center; border-style:dashed; opacity:.95;">
            ${employeeId ? `${shift.start}–${shift.end}` : "—"}
          </div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
  }
}

async function renderScheduleEmployee(){
  pingActivity();
  await loadSettings();

  const me = state.currentUser;
  const weekKey = weekKeyFromDate(new Date());
  const weekMap = await getScheduleWeekMap(weekKey);

  setAppHTML(`
    ${brandHTML(`Welcome ${escapeHTML(me.name)} — Schedule`)}
    ${navBarHTML("schedule")}
    <div class="card">
      <div style="font-weight:800;">This Week</div>
      <div class="note">${weekLabel(weekKey)}</div>
    </div>
    <div class="list" id="schedList"></div>
  `);

  const list = qs("#schedList");

  for(let i=0;i<7;i++){
    const rec = weekMap[i];
    const isMe = rec && rec.employeeId === me.id;
    const label = isMe ? `${hhmmTo12(rec.start)} – ${hhmmTo12(rec.end)}` : "Off";

    const row = document.createElement("div");
    row.className = "shiftRow";
    row.innerHTML = `
      <div class="left">
        <div><strong>${DAYS[i]}</strong></div>
        <div class="badge ${isMe ? "glow" : ""}">${label}</div>
      </div>
      <div class="right"></div>
    `;
    list.appendChild(row);
  }
}

/* ---------- Admin page ---------- */

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
<div class="card soft" style="margin-top:10px;">
  <div style="font-weight:800;">Premium Tools</div>
  <div class="note" style="margin-top:6px;">Locked tools glow gold until enabled.</div>
  <div class="row" style="margin-top:10px; flex-wrap:wrap;">
    ${premiumBtnHTML("dashboard","Dashboard","openDashboard()")}
    ${premiumBtnHTML("payroll","Payroll","openPayroll()")}
    ${premiumBtnHTML("weeklyExport","Weekly Export","openWeeklyExport()")}
    ${premiumBtnHTML("audit","Audit","openAudit()")}
  </div>
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
      const lockedShift = !canEditWeek(weekKeyFromDate(new Date(s.in)));
      const buttonsHTML = lockedShift ? `<span class="badge gold">Locked</span>` : `
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn slim" onclick="editShift('${escapeHTML(s.shiftId)}')">Edit</button>
            <button class="btn slim danger" onclick="deleteShift('${escapeHTML(s.shiftId)}')">Delete</button>
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
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  setInterval(autoCloseAt1130, 30000);
  renderLogin();
});
