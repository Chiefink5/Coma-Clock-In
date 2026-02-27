
function openExportModal(){
  openModal("Export Options", `
    <div class="row" style="justify-content:center; gap:12px;">
      <button class="btn" onclick="exportJSON(); closeModal();">Export JSON</button>
      <button class="btn" onclick="exportCSV(); closeModal();">Export CSV</button>
    </div>
  `);
}


function navBarHTML(active){

  const coreRow = `
    <div class="row" style="margin-top:10px; flex-wrap:wrap;">
      <button class="btn ${active==="clock"?"accent":""}" onclick="goHome()">Clock</button>
      
      <button class="btn" onclick="openSettings()">Settings</button>
      <button class="btn" onclick="logout()">Log Out</button>
    </div>
  `;

  if(!state.isAdmin) return coreRow;

  const businessRow = `
    <div class="row" style="margin-top:10px; flex-wrap:wrap;">
      
      <button class="btn" onclick="openExportModal()">Export</button>
      ${hasPremium("schedule") ? `<button class="btn" onclick="openSchedule()">Schedule</button>` : ""}
      ${hasPremium("dashboard") ? `<button class="btn" onclick="openDashboard()">Dashboard</button>` : ""}
      ${hasPremium("payroll") ? `<button class="btn" onclick="openPayroll()">Payroll</button>` : ""}
      ${hasPremium("weeklyExport") ? `<button class="btn" onclick="openWeeklyExport()">Weekly Export</button>` : ""}
      ${hasPremium("audit") ? `<button class="btn" onclick="openAudit()">Audit</button>` : ""}
    </div>
  `;

  const premiumToggle = `
    <div class="row" style="margin-top:10px;">
      <button class="btn slim" onclick="togglePremiumBar()">
        ${state.showPremiumBar ? "Hide Premium Features" : "Show Premium Features"}
      </button>
    </div>
  `;

  const premiumRow = state.showPremiumBar ? `
    <div class="row" style="margin-top:10px; flex-wrap:wrap;">
      ${!hasPremium("schedule") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Schedule')">Schedule</button>` : ""}
      ${!hasPremium("dashboard") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Dashboard')">Dashboard</button>` : ""}
      ${!hasPremium("payroll") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Payroll')">Payroll</button>` : ""}
      ${!hasPremium("weeklyExport") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Weekly Export')">Weekly Export</button>` : ""}
      ${!hasPremium("audit") ? `<button class="btn premium-locked" onclick="renderPremiumLocked('Audit')">Audit</button>` : ""}
    </div>
  ` : "";

  return coreRow + businessRow + premiumToggle + premiumRow;
}

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



function renderPremiumLocked(featureLabel){
  const who = state.isAdmin ? (state.isOwner ? "Admin (Owner)" : "Admin") : `Welcome ${escapeHTML(state.currentUser?.name || "")}!`;
  setAppHTML(`
    ${brandHTML(who)}
    

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
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  setInterval(autoCloseAt1130, 30000);
  renderLogin();
});
