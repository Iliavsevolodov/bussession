(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const backendReady = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = backendReady ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  let adminPassword = sessionStorage.getItem("bs_admin_password") || "";
  let bsRows = [];
  let corpRows = [];
  let operations = [];
  let summary = {};
  let operationFilter = "all";

  const money = (value) => `${new Intl.NumberFormat("ru-RU").format(Number(value || 0))} ₽`;
  const esc = (value) => String(value ?? "").replace(/[&<>'\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[c]));
  const formatDate = (value) => new Date(value).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value; };

  function toast(message, type = "") {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${type}`.trim();
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.className = "toast", 2600);
  }

  async function rpc(name, args = {}) {
    if (!db) throw new Error("BACKEND_NOT_CONFIGURED");
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function showLogin() {
    $("adminLogin").classList.remove("hidden");
    $("adminApp").classList.add("hidden");
    $("mobileNav").classList.add("hidden");
    window.lucide?.createIcons();
  }

  function showApp() {
    $("adminLogin").classList.add("hidden");
    $("adminApp").classList.remove("hidden");
    $("mobileNav").classList.remove("hidden");
    window.lucide?.createIcons();
    loadAll();
  }

  async function validatePassword(password) {
    const ok = await rpc("admin_login", { p_password: password });
    if (!ok) throw new Error("INVALID_PASSWORD");
  }

  async function loadAll() {
    if (!adminPassword) return;
    try {
      const [s, bs, corp, ops] = await Promise.all([
        rpc("admin_summary", { p_password: adminPassword }),
        rpc("admin_list_registrations", { p_password: adminPassword, p_event_type: "bs" }),
        rpc("admin_list_registrations", { p_password: adminPassword, p_event_type: "corporate" }),
        rpc("admin_operations", { p_password: adminPassword, p_limit: 300 })
      ]);
      summary = s || {};
      bsRows = Array.isArray(bs) ? bs : [];
      corpRows = Array.isArray(corp) ? corp : [];
      operations = Array.isArray(ops) ? ops : [];
      renderEverything();
    } catch (error) {
      console.error(error);
      if (/ADMIN_ONLY|INVALID_PASSWORD/i.test(error?.message || "")) {
        adminPassword = "";
        sessionStorage.removeItem("bs_admin_password");
        showLogin();
        toast("Нужно войти снова", "error");
      } else {
        toast(error?.message === "BACKEND_NOT_CONFIGURED" ? "База ещё не подключена" : "Не удалось обновить данные", "error");
      }
    }
  }

  function renderEverything() {
    const bsBalance = Number(summary.bs_balance || 0);
    const corpBalance = Number(summary.corporate_balance || 0);
    const total = bsBalance + corpBalance;
    const bsCollected = Number(summary.bs_income || 0);
    const corpCollected = Number(summary.corporate_income || 0);
    const totalCollected = bsCollected + corpCollected;

    setText("bsBalanceFinance", money(bsBalance));
    setText("corporateBalanceFinance", money(corpBalance));
    setText("totalBalanceFinance", money(total));
    setText("bsAfterExpensesFinance", `После расходов: ${money(bsBalance)}`);
    setText("corpAfterExpensesFinance", `После расходов: ${money(corpBalance)}`);
    setText("totalAfterExpensesFinance", `После расходов: ${money(total)}`);
    setText("bsCollectedFinance", `Всего собрано: ${money(bsCollected)}`);
    setText("corpCollectedFinance", `Всего собрано: ${money(corpCollected)}`);
    setText("totalCollectedFinance", `Всего собрано: ${money(totalCollected)}`);

    setText("bsCount", summary.bs_count || 0);
    setText("corpCount", summary.corporate_count || 0);
    setText("overnightCount", summary.overnight_count || 0);
    setText("insideCount", summary.inside_count || 0);
    setText("bsSubtitle", `${summary.bs_count || 0} участников · ${money(bsCollected)} собрано`);
    setText("corpSubtitle", `${summary.corporate_count || 0} участников · ${money(corpCollected)} собрано`);
    renderParticipants("bs");
    renderParticipants("corporate");
    renderOperations();
    window.lucide?.createIcons();
  }

  function renderParticipants(type) {
    const rows = type === "bs" ? bsRows : corpRows;
    const input = $(type === "bs" ? "bsSearch" : "corpSearch");
    const target = $(type === "bs" ? "bsParticipants" : "corpParticipants");
    if (!input || !target) return;
    const q = (input.value || "").trim().toLowerCase();
    const filtered = rows.filter(r => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q));
    if (!filtered.length) {
      target.innerHTML = `<div class="empty-state">${q ? "Ничего не найдено" : "Пока в этом списке нет участников"}</div>`;
      return;
    }
    target.innerHTML = filtered.map(row => {
      const overnight = type === "corporate" && row.overnight;
      const tags = type === "bs"
        ? `<span class="tag ${row.checked_in ? "yellow" : ""}">${row.checked_in ? "✓ В зале" : "БС"}</span>`
        : `<span class="tag yellow">${overnight ? "💤 С ночёвкой" : "Корпоратив"}</span>`;
      return `<article class="participant-row">
        <div class="participant-no">${String(row.registration_no).padStart(2,"0")}</div>
        <div class="participant-main"><strong>${esc(row.first_name)} ${esc(row.last_name)}</strong><small>${tags}<span>${money(row.fee_amount)}</span></small></div>
        <div class="participant-actions"><button class="mini-button danger" data-remove-registration="${row.registration_id}" data-event-type="${type}" title="Убрать из списка"><i data-lucide="trash-2"></i></button></div>
      </article>`;
    }).join("");
  }

  function renderOperations() {
    let rows = operations;
    if (operationFilter === "bs") rows = rows.filter(x => x.account === "bs");
    if (operationFilter === "corporate") rows = rows.filter(x => x.account === "corporate");
    if (operationFilter === "expense") rows = rows.filter(x => x.entry_type === "expense");
    const history = $("operationsHistory");
    if (history) history.innerHTML = rows.length ? rows.map(operationHtml).join("") : '<div class="empty-state">Нет операций по этому фильтру</div>';
  }

  function operationHtml(op) {
    const isExpense = op.entry_type === "expense" || op.entry_type === "reversal";
    const account = op.account === "bs" ? "Business Session" : "Корпоратив";
    const sign = isExpense ? "−" : "+";
    return `<article class="operation-row ${isExpense ? "expense" : ""}">
      <div class="op-icon"><i data-lucide="${isExpense ? "arrow-down" : "arrow-up"}"></i></div>
      <div><strong>${esc(op.title)}</strong><small>${account} · ${formatDate(op.created_at)}</small></div>
      <div class="op-amount">${sign}${money(op.amount)}</div>
    </article>`;
  }

  function switchView(view) {
    document.querySelectorAll(".view-section").forEach(el => el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll("[data-view]").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.lucide?.createIcons();
  }

  function syncOvernight(prefix) {
    const corp = $(`${prefix}Corp`);
    const wrap = $(`${prefix}OvernightWrap`);
    const overnight = $(`${prefix}Overnight`);
    if (!corp || !wrap || !overnight) return;
    wrap.classList.toggle("hidden", !corp.checked);
    if (!corp.checked) overnight.checked = false;
  }

  async function addParticipant(firstName, lastName, addBs, addCorp, overnight) {
    if (!addBs && !addCorp) throw new Error("SELECT_EVENT");
    return rpc("admin_add_participant", {
      p_password: adminPassword,
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim(),
      p_add_bs: addBs,
      p_add_corporate: addCorp,
      p_overnight: Boolean(overnight && addCorp)
    });
  }

  async function handleParticipantSubmit({first,last,bs,corp,overnight,button,onDone}) {
    button.disabled = true;
    const old = button.innerHTML;
    button.innerHTML = '<span>Сохраняем…</span>';
    try {
      await addParticipant(first.value, last.value, bs.checked, corp.checked, overnight.checked);
      first.value = ""; last.value = ""; overnight.checked = false;
      toast("Участник добавлен, взнос зачислен ✨");
      onDone?.();
      await loadAll();
    } catch (error) {
      console.error(error);
      let msg = "Не удалось добавить участника";
      if (error?.message === "SELECT_EVENT") msg = "Выбери БС, корпоратив или оба списка";
      if (/DUPLICATE_REGISTRATION/i.test(error?.message || "")) msg = "Такой участник уже есть в выбранном списке";
      toast(msg, "error");
    } finally { button.disabled = false; button.innerHTML = old; window.lucide?.createIcons(); }
  }

  function openParticipantModal(target = "bs") {
    $("participantBs").checked = target === "bs";
    $("participantCorp").checked = target === "corporate";
    $("participantOvernight").checked = false;
    syncOvernight("participant");
    $("participantModal").classList.add("open");
    $("participantModal").setAttribute("aria-hidden","false");
    setTimeout(() => $("participantFirstName").focus(), 100);
  }
  function closeParticipantModal() { $("participantModal").classList.remove("open"); $("participantModal").setAttribute("aria-hidden","true"); }

  $("adminLoginForm").addEventListener("submit", async e => {
    e.preventDefault(); const btn=$("adminLoginButton"); btn.disabled=true;
    try { const pass=$("adminPassword").value; await validatePassword(pass); adminPassword=pass; sessionStorage.setItem("bs_admin_password",pass); $("adminPassword").value=""; showApp(); }
    catch(error){ console.error(error); toast(error?.message === "BACKEND_NOT_CONFIGURED" ? "База ещё не подключена" : "Неверный пароль", "error"); }
    finally{btn.disabled=false;}
  });
  $("logoutButton").addEventListener("click",()=>{adminPassword="";sessionStorage.removeItem("bs_admin_password");showLogin();});
  document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));
  document.querySelectorAll("[data-view-link]").forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.viewLink)));
  $("quickCorp").addEventListener("change",()=>syncOvernight("quick"));
  $("participantCorp").addEventListener("change",()=>syncOvernight("participant"));
  $("quickParticipantForm").addEventListener("submit",e=>{e.preventDefault();handleParticipantSubmit({first:$("quickFirstName"),last:$("quickLastName"),bs:$("quickBs"),corp:$("quickCorp"),overnight:$("quickOvernight"),button:e.submitter,onDone:()=>syncOvernight("quick")});});
  $("participantForm").addEventListener("submit",e=>{e.preventDefault();handleParticipantSubmit({first:$("participantFirstName"),last:$("participantLastName"),bs:$("participantBs"),corp:$("participantCorp"),overnight:$("participantOvernight"),button:$("participantSubmit"),onDone:closeParticipantModal});});
  document.querySelectorAll("[data-add-target]").forEach(btn=>btn.addEventListener("click",()=>openParticipantModal(btn.dataset.addTarget)));
  $("closeParticipantModal").addEventListener("click",closeParticipantModal);
  $("participantModal").addEventListener("click",e=>{if(e.target===$("participantModal"))closeParticipantModal();});
  $("bsSearch").addEventListener("input",()=>renderParticipants("bs"));
  $("corpSearch").addEventListener("input",()=>renderParticipants("corporate"));

  document.addEventListener("click", async e => {
    const remove = e.target.closest("[data-remove-registration]");
    if (remove) {
      const type = remove.dataset.eventType;
      if (!confirm(`Убрать участника из списка «${type === "bs" ? "Business Session" : "Корпоратив"}»? Взнос будет сторнирован, история операции сохранится.`)) return;
      remove.disabled = true;
      try { await rpc("admin_remove_registration", { p_password:adminPassword, p_registration_id:remove.dataset.removeRegistration }); toast("Участник убран из списка"); await loadAll(); }
      catch(error){console.error(error);toast("Не удалось изменить список","error");remove.disabled=false;}
    }
  });

  $("expenseForm").addEventListener("submit", async e => {
    e.preventDefault(); const btn=e.submitter; btn.disabled=true;
    try {
      const result = await rpc("admin_add_expense", { p_password:adminPassword, p_title:$("expenseTitle").value.trim(), p_amount:Number($("expenseAmount").value), p_preferred_account:$("expenseAccount").value });
      $("expenseTitle").value=""; $("expenseAmount").value="";
      toast(result?.split ? "Расход списан с двух счетов" : "Расход добавлен");
      await loadAll();
    } catch(error){console.error(error);toast(/INSUFFICIENT_FUNDS/i.test(error?.message||"") ? "Недостаточно денег на двух счетах" : "Не удалось добавить расход","error");}
    finally{btn.disabled=false;}
  });
  document.querySelectorAll("[data-op-filter]").forEach(btn=>btn.addEventListener("click",()=>{operationFilter=btn.dataset.opFilter;document.querySelectorAll("[data-op-filter]").forEach(x=>x.classList.toggle("active",x===btn));renderOperations();window.lucide?.createIcons();}));

  async function init(){window.lucide?.createIcons();syncOvernight("quick");if(!db||!adminPassword){showLogin();return;}try{await validatePassword(adminPassword);showApp();}catch{adminPassword="";sessionStorage.removeItem("bs_admin_password");showLogin();}}
  init();
})();
