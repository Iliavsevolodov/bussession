(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const backendReady = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = backendReady ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  let checkinPassword = sessionStorage.getItem("bs_checkin_password") || "";
  let participants = [];
  let winners = [];
  let attendanceFilter = "all";
  let currentView = "list";

  const esc = value => String(value ?? "").replace(/[&<>'\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[c]));
  const formatDate = value => new Date(value).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });

  function toast(message, type="") { const n=$("toast");n.textContent=message;n.className=`toast show ${type}`.trim();clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.className="toast",2400); }
  async function rpc(name,args={}){if(!db)throw new Error("BACKEND_NOT_CONFIGURED");const{data,error}=await db.rpc(name,args);if(error)throw error;return data;}

  function showLogin(){$("checkinLogin").classList.remove("hidden");$("checkinApp").classList.add("hidden");window.lucide?.createIcons();}
  function showApp(){$("checkinLogin").classList.add("hidden");$("checkinApp").classList.remove("hidden");window.lucide?.createIcons();loadAll();}
  async function validatePassword(password){const ok=await rpc("checkin_login",{p_password:password});if(!ok)throw new Error("INVALID_PASSWORD");}

  async function loadAll(){
    if(!checkinPassword)return;
    try{
      const [rows, win] = await Promise.all([
        rpc("checkin_list",{p_password:checkinPassword}),
        rpc("checkin_winners",{p_password:checkinPassword})
      ]);
      participants=Array.isArray(rows)?rows:[];
      winners=Array.isArray(win)?win:[];
      render();
    }catch(error){
      console.error(error);
      if(/CHECKIN_ONLY|INVALID_PASSWORD/i.test(error?.message||"")){checkinPassword="";sessionStorage.removeItem("bs_checkin_password");showLogin();toast("Нужно войти снова","error");}
      else toast(error?.message==="BACKEND_NOT_CONFIGURED"?"База ещё не подключена":"Не удалось загрузить список","error");
    }
  }

  function render(){
    const inside=participants.filter(x=>x.checked_in).length;
    $("checkinTotal").textContent=participants.length;
    $("checkinInside").textContent=inside;
    $("checkinWaiting").textContent=participants.length-inside;
    $("rafflePoolCount").textContent=eligiblePool().length;
    renderList();renderWinners();window.lucide?.createIcons();
  }

  function renderList(){
    const q=($("checkinSearch").value||"").trim().toLowerCase();
    let rows=participants.filter(x=>`${x.first_name} ${x.last_name}`.toLowerCase().includes(q));
    if(attendanceFilter==="inside")rows=rows.filter(x=>x.checked_in);
    if(attendanceFilter==="waiting")rows=rows.filter(x=>!x.checked_in);
    const target=$("checkinParticipants");
    if(!rows.length){target.innerHTML='<div class="empty-state">Ничего не найдено</div>';return;}
    target.innerHTML=rows.map(row=>`<article class="checkin-person ${row.checked_in?"is-inside":""}">
      <div class="participant-no">${String(row.registration_no).padStart(2,"0")}</div>
      <div class="person-name"><strong>${esc(row.first_name)} ${esc(row.last_name)}</strong><small>${row.checked_in?"Участник уже в зале":"Ожидаем на входе"}</small></div>
      <button class="attendance-button ${row.checked_in?"checked":""}" data-checkin-id="${row.registration_id}" data-next-state="${row.checked_in?"false":"true"}">${row.checked_in?"✓ В зале":"Отметить"}</button>
    </article>`).join("");
  }

  function eligiblePool(){
    const exclude=$("excludeWinners")?.checked;
    const winnerIds=new Set(winners.map(x=>x.registration_id));
    return participants.filter(x=>x.checked_in && (!exclude || !winnerIds.has(x.registration_id)));
  }

  function renderWinners(){
    const target=$("winnerHistory");
    if(!winners.length){target.innerHTML='<div class="empty-state">Победителей пока нет</div>';return;}
    target.innerHTML=winners.map((row,index)=>`<article class="winner-row"><div class="winner-medal">${index===0?"🏆":"🎁"}</div><div><strong>${esc(row.first_name)} ${esc(row.last_name)}</strong><small>№ ${String(row.registration_no).padStart(2,"0")}</small></div><time>${formatDate(row.created_at)}</time></article>`).join("");
  }

  async function setAttendance(registrationId,nextState,button){
    button.disabled=true;
    try{await rpc("checkin_set_presence",{p_password:checkinPassword,p_registration_id:registrationId,p_checked_in:nextState});await loadAll();toast(nextState?"Участник отмечен в зале ✓":"Отметка снята");}
    catch(error){console.error(error);toast("Не удалось изменить отметку","error");button.disabled=false;}
  }

  function switchCheckinView(view){
    currentView=view;
    document.querySelectorAll(".checkin-view").forEach(x=>x.classList.toggle("active",x.id===`checkin-${view}`));
    document.querySelectorAll("[data-checkin-view]").forEach(x=>x.classList.toggle("active",x.dataset.checkinView===view));
    if(view==="raffle")$("rafflePoolCount").textContent=eligiblePool().length;
    window.lucide?.createIcons();
  }

  async function drawWinner(){
    const btn=$("drawWinner");
    const pool=eligiblePool();
    if(!pool.length){toast("Нет доступных участников для розыгрыша","error");return;}
    btn.disabled=true;
    const display=$("raffleDisplay");
    display.classList.add("spinning");
    let ticks=0;
    const timer=setInterval(()=>{
      const pick=pool[Math.floor(Math.random()*pool.length)];
      display.innerHTML=`<span>Выбираем…</span><strong>${esc(pick.first_name)} ${esc(pick.last_name)}</strong>`;
      ticks++;
      if(ticks>16)clearInterval(timer);
    },90);
    try{
      const winner=await rpc("checkin_draw_winner",{p_password:checkinPassword,p_exclude_previous:$("excludeWinners").checked});
      setTimeout(async()=>{
        clearInterval(timer);display.classList.remove("spinning");
        if(winner){display.innerHTML=`<span>Победитель 🎉</span><strong>${esc(winner.first_name)} ${esc(winner.last_name)}</strong>`;toast("Победитель выбран 🎁");}
        btn.disabled=false;await loadAll();
      },1700);
    }catch(error){clearInterval(timer);display.classList.remove("spinning");btn.disabled=false;console.error(error);toast(/NO_ELIGIBLE_PARTICIPANTS/i.test(error?.message||"")?"Все доступные участники уже выигрывали":"Не удалось провести розыгрыш","error");}
  }

  $("checkinLoginForm").addEventListener("submit",async e=>{e.preventDefault();const btn=$("checkinLoginButton");btn.disabled=true;try{const pass=$("checkinPassword").value;await validatePassword(pass);checkinPassword=pass;sessionStorage.setItem("bs_checkin_password",pass);$("checkinPassword").value="";showApp();}catch(error){console.error(error);toast(error?.message==="BACKEND_NOT_CONFIGURED"?"База ещё не подключена":"Неверный пароль","error");}finally{btn.disabled=false;}});
  $("checkinLogout").addEventListener("click",()=>{checkinPassword="";sessionStorage.removeItem("bs_checkin_password");showLogin();});
  $("checkinSearch").addEventListener("input",renderList);
  document.querySelectorAll("[data-attendance-filter]").forEach(btn=>btn.addEventListener("click",()=>{attendanceFilter=btn.dataset.attendanceFilter;document.querySelectorAll("[data-attendance-filter]").forEach(x=>x.classList.toggle("active",x===btn));renderList();}));
  document.querySelectorAll("[data-checkin-view]").forEach(btn=>btn.addEventListener("click",()=>switchCheckinView(btn.dataset.checkinView)));
  $("excludeWinners").addEventListener("change",()=>$("rafflePoolCount").textContent=eligiblePool().length);
  $("drawWinner").addEventListener("click",drawWinner);
  document.addEventListener("click",e=>{const btn=e.target.closest("[data-checkin-id]");if(btn)setAttendance(btn.dataset.checkinId,btn.dataset.nextState==="true",btn);});

  async function init(){window.lucide?.createIcons();if(!db||!checkinPassword){showLogin();return;}try{await validatePassword(checkinPassword);showApp();}catch{checkinPassword="";sessionStorage.removeItem("bs_checkin_password");showLogin();}}
  init();
})();
