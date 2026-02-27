const ADMIN_PIN = "9999";
const OWNER_PIN = "1421";
const WEBHOOK_URL = "PUT_DISCORD_WEBHOOK_URL_HERE";

let state = {
  currentUser:null,
  isAdmin:false,
  isOwner:false,
  rounding:false,
  grace:0,
  storeName:"Shop Clock",
  logo:"",
  lockedWeeks:[]
};

let db;

function initDB(){
  return new Promise(res=>{
    const request=indexedDB.open("clockDB",1);
    request.onupgradeneeded=e=>{
      db=e.target.result;
      db.createObjectStore("employees",{keyPath:"id"});
      db.createObjectStore("shifts",{keyPath:"shiftId"});
      db.createObjectStore("settings",{keyPath:"key"});
    };
    request.onsuccess=e=>{
      db=e.target.result;
      res();
    };
  });
}

function save(store,data){
  return new Promise(res=>{
    const tx=db.transaction(store,"readwrite");
    tx.objectStore(store).put(data);
    tx.oncomplete=()=>res();
  });
}

function getAll(store){
  return new Promise(res=>{
    const tx=db.transaction(store,"readonly");
    const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>res(req.result);
  });
}

function formatTime(d){
  const mm=String(d.getMonth()+1).padStart(2,"0");
  const dd=String(d.getDate()).padStart(2,"0");
  const yy=String(d.getFullYear()).slice(-2);
  const hh=String(d.getHours()).padStart(2,"0");
  const mi=String(d.getMinutes()).padStart(2,"0");
  return `${mm}/${dd}/${yy} ${hh}:${mi}`;
}

function getWeekStart(date){
  const d=new Date(date);
  const day=d.getDay();
  const diff=d.getDate()-(day===0?6:day-1);
  return new Date(d.setDate(diff));
}

function renderLogin(){
  document.getElementById("app").innerHTML=`
  <div class="topbar"><h2>${state.storeName}</h2></div>
  <div id="pinDisplay" style="text-align:center;font-size:24px;margin-bottom:10px;"></div>
  <div class="pinpad"></div>
  `;
  const pad=document.querySelector(".pinpad");
  let pin="";
  const numbers=[1,2,3,4,5,6,7,8,9,"C",0,"OK"];
  numbers.forEach(n=>{
    const b=document.createElement("button");
    b.textContent=n;
    b.onclick=async()=>{
      if(n==="C"){pin="";}
      else if(n==="OK"){handleLogin(pin);pin="";}
      else{pin+=n;}
      document.getElementById("pinDisplay").textContent="•".repeat(pin.length);
    };
    pad.appendChild(b);
  });
}

async function handleLogin(pin){
  if(pin===ADMIN_PIN){
    state.currentUser="admin";
    state.isAdmin=true;
    state.isOwner=false;
    renderAdmin();
    return;
  }
  if(pin===OWNER_PIN){
    state.currentUser="owner";
    state.isAdmin=true;
    state.isOwner=true;
    renderAdmin();
    return;
  }
  const employees=await getAll("employees");
  const user=employees.find(e=>e.pin===pin);
  if(user){
    state.currentUser=user;
    state.isAdmin=false;
    state.isOwner=false;
    renderEmployee();
  }
}

function autoLogout(){
  setTimeout(()=>{
    state.currentUser=null;
    state.isAdmin=false;
    state.isOwner=false;
    renderLogin();
  },state.isAdmin?120000:300000);
}

async function clockIn(){
  const now=new Date();
  const shift={
    shiftId:Date.now().toString(),
    employeeId:state.currentUser.id,
    in:now,
    out:null,
    autoClosed:false
  };
  await save("shifts",shift);
  renderEmployee();
}

async function clockOut(){
  const shifts=await getAll("shifts");
  const open=shifts.find(s=>s.employeeId===state.currentUser.id && !s.out);
  if(!open)return;
  open.out=new Date();
  await save("shifts",open);
  renderEmployee();
}

async function renderEmployee(){
  autoLogout();
  const shifts=await getAll("shifts");
  const my=shifts.filter(s=>s.employeeId===state.currentUser.id);
  let total=0;
  const weekStart=getWeekStart(new Date()).toDateString();
  my.forEach(s=>{
    if(s.out){
      if(getWeekStart(s.in).toDateString()===weekStart){
        total+=(new Date(s.out)-new Date(s.in))/3600000;
      }
    }
  });
  const pay=total*state.currentUser.rate;
  document.getElementById("app").innerHTML=`
  <div class="topbar"><h2>${state.storeName}</h2></div>
  <div style="text-align:center">
  <button class="primary" onclick="clockIn()">Clock In</button>
  <button class="danger" onclick="clockOut()">Clock Out</button>
  <button onclick="renderLogin()">Log Out</button>
  </div>
  <div style="text-align:center;margin-top:10px;">Earned This Week: $${pay.toFixed(2)}</div>
  `;
  my.reverse().forEach(s=>{
    const card=document.createElement("div");
    card.className="card";
    card.innerHTML=`
    In: ${formatTime(new Date(s.in))}<br>
    Out: ${s.out?formatTime(new Date(s.out)):"--"}
    `;
    document.getElementById("app").appendChild(card);
  });
}

async function renderAdmin(){
  autoLogout();
  const employees=await getAll("employees");
  const shifts=await getAll("shifts");
  let html=`<div class="topbar"><h2>${state.storeName} - Admin</h2></div>`;
  html+=`<button onclick="renderLogin()">Log Out</button>`;
  html+=`<button onclick="exportCSV()">Export CSV</button>`;
  html+=`<button onclick="exportJSON()">Export JSON</button>`;
  html+=`<input type="file" onchange="importJSON(event)">`;
  html+=`<div>`;
  employees.forEach(e=>{
    const empShifts=shifts.filter(s=>s.employeeId===e.id);
    let total=0;
    empShifts.forEach(s=>{
      if(s.out){
        total+=(new Date(s.out)-new Date(s.in))/3600000;
      }
    });
    html+=`<div class="card">${e.name}<br>Hours: ${total.toFixed(2)}<br>Pay: $${(total*e.rate).toFixed(2)}</div>`;
  });
  html+=`</div>`;
  document.getElementById("app").innerHTML=html;
}

async function exportCSV(){
  const shifts=await getAll("shifts");
  const employees=await getAll("employees");
  let csv="Employee,Shift In,Shift Out\n";
  shifts.forEach(s=>{
    const e=employees.find(emp=>emp.id===s.employeeId);
    csv+=`${e.name},${formatTime(new Date(s.in))},${s.out?formatTime(new Date(s.out)):""}\n`;
  });
  const blob=new Blob([csv],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="week.csv";
  a.click();
}

async function exportJSON(){
  const shifts=await getAll("shifts");
  const employees=await getAll("employees");
  const data={employees,shifts};
  const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="backup.json";
  a.click();
}

function importJSON(e){
  const file=e.target.files[0];
  const reader=new FileReader();
  reader.onload=async()=>{
    const data=JSON.parse(reader.result);
    for(const emp of data.employees) await save("employees",emp);
    for(const shift of data.shifts) await save("shifts",shift);
    renderAdmin();
  };
  reader.readAsText(file);
}

initDB().then(()=>{
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js");
  }
  renderLogin();
});