
const ADMIN_PIN="7482";
const OWNER_PIN="1421";
const DEV_UNLOCK_CODE="2521";
const WEBHOOK_URL="https://discord.com/api/webhooks/1476784807634534532/sZfyQIF-YZQnyWOqgI3Wmkca6Rv9mCr2FxbqCvwq-DM0w4JQVv0YE0qULW7f7ImTM-Td";

let state={
  user:null,
  isAdmin:false,
  isOwner:false,
  currentView:"login",
  showPremiumBar:false,
  premiumFlags:{
    schedule:false,
    dashboard:false,
    payroll:false,
    weeklyExport:false,
    audit:false
  }
};

function hasPremium(key){
  if(state.isOwner) return true;
  return state.premiumFlags[key]===true;
}

function render(){
  const app=document.getElementById("app");
  if(state.currentView==="login") return renderLogin(app);
  if(state.currentView==="admin") return renderAdmin(app);
}

function renderLogin(app){
  app.innerHTML=`
  <div class="center">
    <h2>Shop Clock</h2>
    <input id="pin" type="password" placeholder="Enter PIN" />
    <button class="btn" onclick="login()">Login</button>
  </div>`;
}

function login(){
  const pin=document.getElementById("pin").value;
  if(pin===OWNER_PIN){
    state.isOwner=true;
    state.isAdmin=true;
    state.user="Owner";
    state.currentView="admin";
  }else if(pin===ADMIN_PIN){
    state.isAdmin=true;
    state.user="Admin";
    state.currentView="admin";
  }
  render();
}

function logout(){
  state={...state,user:null,isAdmin:false,isOwner:false,currentView:"login"};
  render();
}

function togglePremiumBar(){
  state.showPremiumBar=!state.showPremiumBar;
  render();
}

function navBar(){
  const premiumUnlocked=Object.keys(state.premiumFlags).filter(k=>hasPremium(k));
  return `
  <div class="row">
    <button class="btn accent" onclick="goClock()">Clock</button>
    <button class="btn">Add Employee</button>
    <button class="btn">Settings</button>
    <button class="btn" onclick="logout()">Log Out</button>
  </div>

  <div class="row">
    <button class="btn">Import</button>
    <button class="btn" onclick="openExport()">Export</button>
    ${hasPremium("schedule")?'<button class="btn">Schedule</button>':""}
    ${hasPremium("dashboard")?'<button class="btn">Dashboard</button>':""}
    ${hasPremium("payroll")?'<button class="btn">Payroll</button>':""}
    ${hasPremium("weeklyExport")?'<button class="btn">Weekly Export</button>':""}
    ${hasPremium("audit")?'<button class="btn">Audit</button>':""}
  </div>

  <div class="row">
    <button class="btn" onclick="togglePremiumBar()">
      ${state.showPremiumBar?"Hide Premium Features":"Show Premium Features"}
    </button>
  </div>

  ${state.showPremiumBar?`
  <div class="row">
    ${!hasPremium("schedule")?'<button class="btn premium-locked">Schedule</button>':""}
    ${!hasPremium("dashboard")?'<button class="btn premium-locked">Dashboard</button>':""}
    ${!hasPremium("payroll")?'<button class="btn premium-locked">Payroll</button>':""}
    ${!hasPremium("weeklyExport")?'<button class="btn premium-locked">Weekly Export</button>':""}
    ${!hasPremium("audit")?'<button class="btn premium-locked">Audit</button>':""}
  </div>`:""}
  `;
}

function renderAdmin(app){
  app.innerHTML=`
  <div style="padding:20px">
    <h2>Shop Clock</h2>
    <div>${state.user}</div>
    ${navBar()}
    <div class="card">Admin Dashboard Content Area</div>
  </div>`;
}

function goClock(){}

function openExport(){
  alert("Export JSON or CSV");
}

render();
