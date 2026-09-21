(() => {
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) return;
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = id => document.getElementById(id);
  const password = () => sessionStorage.getItem('bs_admin_password') || '';

  function ensureButtons() {
    [['view-bs','copyBsList','bs'],['view-corporate','copyCorporateList','corporate']].forEach(([view,id,target]) => {
      if ($(id)) return;
      const toolbar = $(`${view}`)?.querySelector('.section-toolbar');
      const add = toolbar?.querySelector(`[data-add-target="${target}"]`);
      if (!toolbar || !add) return;
      let actions = toolbar.querySelector('.section-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'section-actions';
        toolbar.appendChild(actions);
        actions.appendChild(add);
      }
      const b = document.createElement('button');
      b.id = id; b.type = 'button'; b.className = 'primary-button compact copy-list-button';
      b.innerHTML = '<i data-lucide="copy"></i><span>Скопировать список</span>';
      actions.insertBefore(b, add);
    });
  }

  function installStyles() {
    if ($('copyListStyles')) return;
    const s = document.createElement('style');
    s.id = 'copyListStyles';
    s.textContent = `
      .app-header .page-title{font-family:Manrope,system-ui,sans-serif!important;font-size:12px!important;line-height:1.3!important;letter-spacing:0!important;font-weight:700!important;margin:4px 0 0!important}
      .section-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      .copy-list-button{background:#fff!important;color:#17150f!important;border:1px solid rgba(23,21,15,.12)!important;box-shadow:0 10px 30px rgba(23,21,15,.06)!important}
      .copy-list-button.is-copied{background:#17150f!important;color:#fff!important;border-color:#17150f!important}

      #view-finance .finance-balances{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
      #view-finance .finance-balances .balance-card{min-width:0}
      #view-finance .finance-balances .balance-card.dark{grid-column:1/-1!important}
      .finance-card-meta{display:grid;gap:4px;margin-top:9px}
      .finance-card-meta small{display:block;font-size:11px;line-height:1.35;font-weight:700}
      #view-finance .finance-balances .balance-card.dark .finance-card-meta{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}

      @media(max-width:700px){
        #view-finance .finance-balances{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important}
        #view-finance .finance-balances .balance-card{min-height:132px!important;padding:14px!important;border-radius:20px!important}
        #view-finance .finance-balances .balance-card strong{font-size:clamp(20px,6.8vw,30px)!important}
        #view-finance .finance-balances .balance-card>span{font-size:10px!important}
        #view-finance .finance-balances .balance-card.dark{grid-column:1/-1!important;min-height:126px!important}
        .finance-card-meta small{font-size:9px!important}
        #view-bs .section-toolbar,#view-corporate .section-toolbar{flex-direction:column;align-items:stretch!important;gap:12px;margin-bottom:14px}
        #view-bs .section-actions,#view-corporate .section-actions{display:grid;grid-template-columns:1fr 1fr;width:100%;gap:10px}
        #view-bs .section-actions .compact,#view-corporate .section-actions .compact{width:100%!important;min-width:0;min-height:48px;padding:0 12px!important;border-radius:15px}
        #view-bs .section-actions .compact span,#view-corporate .section-actions .compact span{display:inline!important;white-space:nowrap;font-size:11px}
      }
    `;
    document.head.appendChild(s);
  }

  async function rows(type) {
    const {data,error} = await db.rpc('admin_list_registrations',{p_password:password(),p_event_type:type});
    if (error) throw error;
    return Array.isArray(data) ? data.slice().sort((a,b)=>Number(a.registration_no)-Number(b.registration_no)) : [];
  }

  const message = (type,list) => [type==='bs'?'Участники Business Session':'Участники корпоратива','',...list.map(r=>`${r.registration_no}. ${r.first_name} ${r.last_name}${type==='corporate'&&r.overnight?' 💤':''}`)].join('\n');

  function legacy(text) {
    const a=document.createElement('textarea');
    a.value=text; a.readOnly=true; a.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(a); a.select();
    let ok=false; try{ok=document.execCommand('copy')}catch(_){} a.remove(); return ok;
  }

  async function copy(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch(_){}
    }
    return legacy(text);
  }

  async function handle(button,type) {
    if (!button || button.disabled) return;
    button.disabled=true;
    const old=button.innerHTML;
    try {
      const list=await rows(type);
      if(!list.length) throw new Error('EMPTY');
      const text=message(type,list);
      const ok=await copy(text);
      if(!ok) {
        window.prompt('Скопируй список:',text);
      } else {
        button.classList.add('is-copied');
        button.innerHTML='<i data-lucide="check"></i><span>Скопировано</span>';
        window.lucide?.createIcons();
        setTimeout(()=>{
          button.classList.remove('is-copied');
          button.innerHTML=old;
          button.disabled=false;
          window.lucide?.createIcons();
        },1800);
        return;
      }
    } catch(e) {
      console.error(e);
    }
    button.innerHTML=old;
    button.disabled=false;
    window.lucide?.createIcons();
  }

  ensureButtons();
  installStyles();
  window.lucide?.createIcons();
  $('copyBsList')?.addEventListener('click',()=>handle($('copyBsList'),'bs'));
  $('copyCorporateList')?.addEventListener('click',()=>handle($('copyCorporateList'),'corporate'));
})();