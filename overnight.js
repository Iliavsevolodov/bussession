(() => {
  const cfg = window.APP_CONFIG || {};
  const ready = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  if (!ready) return;

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const money = (value) => `${new Intl.NumberFormat("ru-RU").format(Number(value || 0))} ₽`;
  const returnViewKey = "bs_return_view";

  function toast(message, type = "") {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${type}`.trim();
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.className = "toast"; }, 2600);
  }

  function installStyles() {
    if ($("overnightToggleStyles")) return;
    const style = document.createElement("style");
    style.id = "overnightToggleStyles";
    style.textContent = `
      .overnight-action {
        min-height: 38px;
        border: 1px solid rgba(27,22,8,.10);
        border-radius: 12px;
        padding: 0 11px;
        background: #fff8d7;
        color: #5d4800;
        font: 800 12px/1.1 Manrope, sans-serif;
        white-space: nowrap;
        cursor: pointer;
        transition: transform .16s ease, box-shadow .16s ease, background .16s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .overnight-action:hover { transform: translateY(-1px); box-shadow: 0 7px 18px rgba(145,105,0,.12); }
      .overnight-action:active { transform: scale(.98); }
      .overnight-action.active { background: #ffd72a; color: #171205; border-color: rgba(180,124,0,.18); }
      .overnight-action:disabled { opacity: .58; cursor: wait; transform: none; }
      .participant-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
      @media (max-width: 640px) {
        #corpParticipants .participant-row {
          grid-template-columns: 40px minmax(0,1fr) auto;
          align-items:center;
          gap:8px;
          padding:10px 9px;
          min-height:0;
        }
        #corpParticipants .participant-main strong { font-size:13px; }
        #corpParticipants .participant-main small { margin-top:3px; gap:4px; }
        #corpParticipants .participant-actions {
          width:auto;
          grid-column:auto;
          justify-content:flex-end;
          margin-top:0;
          gap:5px;
          flex-wrap:nowrap;
        }
        #corpParticipants .participant-actions .mini-button {
          width:34px;
          height:34px;
          border-radius:11px;
          flex:0 0 auto;
        }
        .overnight-action {
          min-height:34px;
          padding:0 9px;
          border-radius:11px;
          font-size:10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function enhanceCorporateList() {
    const target = $("corpParticipants");
    if (!target) return;

    target.querySelectorAll(".participant-row").forEach((row) => {
      if (row.querySelector(".overnight-action")) return;
      const remove = row.querySelector("[data-remove-registration]");
      const actions = row.querySelector(".participant-actions");
      const tag = row.querySelector(".tag");
      if (!remove || !actions || !tag) return;

      const overnight = /С ночёвкой/i.test(tag.textContent || "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `overnight-action${overnight ? " active" : ""}`;
      button.dataset.overnightRegistration = remove.dataset.removeRegistration;
      button.dataset.nextOvernight = overnight ? "false" : "true";
      button.title = overnight ? "Убрать ночёвку и вычесть 500 ₽" : "Добавить ночёвку и начислить 500 ₽";
      button.textContent = overnight ? "💤 Ночёвка ✓" : "💤 +500 ₽";
      actions.insertBefore(button, remove);
    });
  }

  async function refreshSummary(password) {
    const { data, error } = await db.rpc("admin_summary", { p_password: password });
    if (error) throw error;
    const s = data || {};
    const bsBalance = Number(s.bs_balance || 0);
    const corpBalance = Number(s.corporate_balance || 0);
    const total = bsBalance + corpBalance;

    ["bsBalance", "bsBalanceFinance"].forEach(id => { if ($(id)) $(id).textContent = money(bsBalance); });
    ["corporateBalance", "corporateBalanceFinance"].forEach(id => { if ($(id)) $(id).textContent = money(corpBalance); });
    ["totalBalance", "totalBalanceFinance"].forEach(id => { if ($(id)) $(id).textContent = money(total); });
    if ($("corporateIncomeLabel")) $("corporateIncomeLabel").textContent = `Собрано ${money(s.corporate_income || 0)}`;
    if ($("corpSubtitle")) $("corpSubtitle").textContent = `${s.corporate_count || 0} участников · ${money(s.corporate_income || 0)} собрано`;
    if ($("overnightCount")) $("overnightCount").textContent = s.overnight_count || 0;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-overnight-registration]");
    if (!button) return;

    const password = sessionStorage.getItem("bs_admin_password") || "";
    if (!password) {
      toast("Нужно войти в админку снова", "error");
      return;
    }

    const next = button.dataset.nextOvernight === "true";
    const row = button.closest(".participant-row");
    const tag = row?.querySelector(".tag");
    const fee = row?.querySelector(".participant-main small > span:last-child");

    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Сохраняем…";

    try {
      const { data, error } = await db.rpc("admin_set_corporate_overnight", {
        p_password: password,
        p_registration_id: button.dataset.overnightRegistration,
        p_overnight: next
      });
      if (error) throw error;

      const result = data || {};
      button.classList.toggle("active", next);
      button.dataset.nextOvernight = next ? "false" : "true";
      button.textContent = next ? "💤 Ночёвка ✓" : "💤 +500 ₽";
      button.title = next ? "Убрать ночёвку и вычесть 500 ₽" : "Добавить ночёвку и начислить 500 ₽";
      if (tag) tag.textContent = next ? "💤 С ночёвкой" : "Корпоратив";
      if (fee && result.fee_amount !== undefined) fee.textContent = money(result.fee_amount);

      await refreshSummary(password);
      toast(result.complimentary
        ? (next ? "Ночёвка добавлена 💤 · без начисления" : "Ночёвка убрана")
        : (next ? "Ночёвка добавлена · +500 ₽ 💤" : "Ночёвка убрана · −500 ₽"));

      sessionStorage.setItem(returnViewKey, "corporate");
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      console.error(error);
      button.textContent = oldText;
      toast("Не удалось изменить ночёвку", "error");
    } finally {
      button.disabled = false;
    }
  });

  function restoreViewAfterReload() {
    const view = sessionStorage.getItem(returnViewKey);
    if (!view) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const app = $("adminApp");
      const button = document.querySelector(`.desktop-nav [data-view="${view}"]`);
      if (app && !app.classList.contains("hidden") && button) {
        sessionStorage.removeItem(returnViewKey);
        button.click();
        clearInterval(timer);
      } else if (attempts > 50) {
        clearInterval(timer);
      }
    }, 100);
  }

  installStyles();
  const target = $("corpParticipants");
  if (target) {
    const observer = new MutationObserver(enhanceCorporateList);
    observer.observe(target, { childList: true, subtree: true });
  }
  enhanceCorporateList();
  restoreViewAfterReload();
})();
