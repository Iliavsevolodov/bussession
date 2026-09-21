(() => {
  const cfg = window.APP_CONFIG || {};
  const ready = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  if (!ready) return;

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const adminPassword = () => sessionStorage.getItem("bs_admin_password") || "";

  function ensureButtons() {
    const configs = [
      { view: "view-bs", id: "copyBsList", target: "bs" },
      { view: "view-corporate", id: "copyCorporateList", target: "corporate" }
    ];

    configs.forEach(({ view, id, target }) => {
      if (document.getElementById(id)) return;
      const section = document.getElementById(view);
      const toolbar = section?.querySelector(".section-toolbar");
      const addButton = toolbar?.querySelector(`[data-add-target="${target}"]`);
      if (!toolbar || !addButton) return;

      let actions = toolbar.querySelector(".section-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "section-actions";
        toolbar.appendChild(actions);
        actions.appendChild(addButton);
      }

      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.className = "primary-button compact copy-list-button";
      button.innerHTML = '<i data-lucide="copy"></i><span>Скопировать список</span>';
      actions.insertBefore(button, addButton);
    });
  }

  function installStyles() {
    if (document.getElementById("copyListStyles")) return;
    const style = document.createElement("style");
    style.id = "copyListStyles";
    style.textContent = `
      .app-header .page-title{
        font-family:Manrope,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;
        font-size:12px!important;
        line-height:1.3!important;
        letter-spacing:0!important;
        font-weight:700!important;
        margin:4px 0 0!important;
      }
      .section-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      .copy-list-button{background:#fff!important;color:#17150f!important;border:1px solid rgba(23,21,15,.12)!important;box-shadow:0 10px 30px rgba(23,21,15,.06)!important}
      .copy-list-button:hover{border-color:#ffd21c!important;transform:translateY(-1px)}
      .copy-list-button.is-copied{background:#17150f!important;color:#fff!important;border-color:#17150f!important}
      @media (max-width:700px){
        .app-header .page-title{font-size:12px!important;margin-top:4px!important}
        #view-bs .section-toolbar,
        #view-corporate .section-toolbar{
          flex-direction:column;
          align-items:stretch!important;
          gap:12px;
          margin-bottom:14px;
        }
        #view-bs .section-toolbar>div:first-child,
        #view-corporate .section-toolbar>div:first-child{
          width:100%;
        }
        #view-bs .section-actions,
        #view-corporate .section-actions{
          display:grid;
          grid-template-columns:1fr 1fr;
          width:100%;
          gap:10px;
          justify-content:stretch;
        }
        #view-bs .section-actions .compact,
        #view-corporate .section-actions .compact{
          width:100%!important;
          min-width:0;
          min-height:48px;
          padding:0 12px!important;
          border-radius:15px;
        }
        #view-bs .section-actions .compact span,
        #view-corporate .section-actions .compact span{
          display:inline!important;
          white-space:nowrap;
          font-size:11px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchRows(eventType) {
    const password = adminPassword();
    if (!password) throw new Error("NO_ADMIN_PASSWORD");
    const { data, error } = await db.rpc("admin_list_registrations", {
      p_password: password,
      p_event_type: eventType
    });
    if (error) throw error;
    return Array.isArray(data) ? data.slice().sort((a, b) => Number(a.registration_no) - Number(b.registration_no)) : [];
  }

  function buildMessage(eventType, rows) {
    const title = eventType === "bs" ? "Участники Business Session" : "Участники корпоратива";
    const lines = rows.map(row => {
      const overnight = eventType === "corporate" && row.overnight ? " 💤" : "";
      return `${row.registration_no}. ${row.first_name} ${row.last_name}${overnight}`;
    });
    return [title, "", ...lines].join("\n");
  }

  function legacyCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    area.remove();
    return ok;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    return legacyCopy(text);
  }

  function showCopied(button) {
    const original = button.innerHTML;
    button.classList.add("is-copied");
    button.innerHTML = '<i data-lucide="check"></i><span>Скопировано</span>';
    window.lucide?.createIcons();
    setTimeout(() => {
      button.classList.remove("is-copied");
      button.innerHTML = original;
      window.lucide?.createIcons();
    }, 2200);
  }

  async function handleCopy(button, eventType) {
    if (!button || button.disabled) return;
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<i data-lucide="loader-circle"></i><span>Готовим…</span>';
    window.lucide?.createIcons();
    try {
      const rows = await fetchRows(eventType);
      if (!rows.length) throw new Error("EMPTY_LIST");
      const message = buildMessage(eventType, rows);
      const copied = await copyText(message);
      if (!copied) {
        window.prompt("Скопируй список:", message);
        button.innerHTML = original;
        window.lucide?.createIcons();
      } else {
        button.innerHTML = original;
        showCopied(button);
      }
    } catch (error) {
      console.error(error);
      button.innerHTML = original;
      window.lucide?.createIcons();
      const text = error?.message === "EMPTY_LIST" ? "Список пока пуст" : "Не удалось скопировать список";
      const toast = document.getElementById("toast");
      if (toast) {
        toast.textContent = text;
        toast.className = "toast show error";
        setTimeout(() => { toast.className = "toast"; }, 2400);
      }
    } finally {
      button.disabled = false;
    }
  }

  ensureButtons();
  installStyles();
  window.lucide?.createIcons();

  const bsButton = document.getElementById("copyBsList");
  const corporateButton = document.getElementById("copyCorporateList");
  bsButton?.addEventListener("click", () => handleCopy(bsButton, "bs"));
  corporateButton?.addEventListener("click", () => handleCopy(corporateButton, "corporate"));
})();
