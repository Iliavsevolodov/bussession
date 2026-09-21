(() => {
  const cfg = window.APP_CONFIG || {};
  const ready = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  const adminPassword = () => sessionStorage.getItem('bs_admin_password') || '';
  let deferredInstallPrompt = null;
  let currentEditState = null;
  let undoBusy = false;
  let participantDecorateQueued = false;
  let undoRefreshTimer = null;

  function toast(message, type = '') {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.className = `toast show ${type}`.trim();
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.className = 'toast'; }, 2600);
  }

  async function rpc(name, args = {}) {
    if (!db) throw new Error('BACKEND_NOT_CONFIGURED');
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function addHeadTag(selector, create) {
    if (document.head.querySelector(selector)) return;
    document.head.appendChild(create());
  }

  function setupPWA() {
    addHeadTag('link[rel="manifest"]', () => {
      const el = document.createElement('link');
      el.rel = 'manifest';
      el.href = './manifest.webmanifest?v=5';
      return el;
    });
    addHeadTag('link[rel="icon"]', () => {
      const el = document.createElement('link');
      el.rel = 'icon';
      el.type = 'image/svg+xml';
      el.href = './icon.svg?v=5';
      return el;
    });
    addHeadTag('meta[name="apple-mobile-web-app-capable"]', () => {
      const el = document.createElement('meta');
      el.name = 'apple-mobile-web-app-capable';
      el.content = 'yes';
      return el;
    });
    addHeadTag('meta[name="apple-mobile-web-app-status-bar-style"]', () => {
      const el = document.createElement('meta');
      el.name = 'apple-mobile-web-app-status-bar-style';
      el.content = 'default';
      return el;
    });
    addHeadTag('meta[name="apple-mobile-web-app-title"]', () => {
      const el = document.createElement('meta');
      el.name = 'apple-mobile-web-app-title';
      el.content = 'Business Session';
      return el;
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js?v=5', { updateViaCache: 'none' })
          .then(reg => reg.update().catch(() => null))
          .catch(console.error);
      });
    }

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      document.querySelectorAll('[data-install-app]').forEach(el => el.remove());
      toast('Приложение установлено ✨');
    });

    installInstallButton();
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function installInstallButton() {
    if (isStandalone()) return;
    if (!deferredInstallPrompt && !isIOS()) return;
    const header = document.querySelector('.app-header, .checkin-header');
    if (!header || header.querySelector('[data-install-app]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.dataset.installApp = '1';
    button.title = 'Установить приложение';
    button.setAttribute('aria-label', 'Установить приложение');
    button.textContent = '↓';
    button.style.fontSize = '25px';
    button.style.fontWeight = '800';
    const last = header.lastElementChild;
    header.insertBefore(button, last || null);
    button.addEventListener('click', handleInstall);
  }

  async function handleInstall() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      return;
    }
    if (isIOS()) showIOSInstallHelp();
  }

  function showIOSInstallHelp() {
    let modal = $('iosInstallModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'iosInstallModal';
      modal.className = 'modal-backdrop open';
      modal.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true">
          <button class="modal-close" type="button" data-close-ios-install aria-label="Закрыть">×</button>
          <span class="section-kicker">Установка на iPhone / iPad</span>
          <h2>Добавить на экран «Домой»</h2>
          <div class="pwa-steps">
            <div><b>1</b><span>Нажми кнопку <strong>«Поделиться»</strong> в Safari.</span></div>
            <div><b>2</b><span>Выбери <strong>«На экран Домой»</strong>.</span></div>
            <div><b>3</b><span>Нажми <strong>«Добавить»</strong>.</span></div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target === modal || e.target.closest('[data-close-ios-install]')) modal.classList.remove('open');
      });
    } else {
      modal.classList.add('open');
    }
  }

  function installStyles() {
    if ($('enhancementsV3Styles')) return;
    const style = document.createElement('style');
    style.id = 'enhancementsV3Styles';
    style.textContent = `
      .edit-choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .edit-choice{display:flex;align-items:center;gap:10px;padding:14px;border:1px solid rgba(23,21,15,.12);border-radius:16px;background:#fff;cursor:pointer}
      .edit-choice input{width:20px;height:20px;accent-color:#ffd21c}
      .edit-choice span{display:flex;flex-direction:column;gap:2px}.edit-choice small{opacity:.58}
      .edit-complimentary{padding:12px 14px;border-radius:14px;background:#fff7cf;font-size:13px;line-height:1.45}
      .undo-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:5px}
      .undo-last-button{background:#fff!important;color:#17150f!important;border:1px solid rgba(23,21,15,.14)!important}
      .undo-last-button:disabled{opacity:.45;cursor:not-allowed;transform:none!important}
      .undo-caption{font-size:11px;max-width:280px;text-align:right;opacity:.58}
      .pwa-steps{display:grid;gap:12px;margin-top:18px}.pwa-steps>div{display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:16px;background:#f8f6ef}
      .pwa-steps b{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:#ffd21c;flex:0 0 auto}.pwa-steps span{line-height:1.45}
      @media(max-width:700px){.edit-choice-grid{grid-template-columns:1fr}.undo-wrap{width:100%;align-items:stretch}.undo-caption{text-align:left;max-width:none}.undo-last-button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function createEditModal() {
    if ($('editParticipantModal')) return;
    const modal = document.createElement('div');
    modal.id = 'editParticipantModal';
    modal.className = 'modal-backdrop';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <button class="modal-close" type="button" data-close-edit aria-label="Закрыть">×</button>
        <span class="section-kicker">Участник</span>
        <h2>Редактировать</h2>
        <form id="editParticipantForm" class="stack-form">
          <div class="form-grid two">
            <label><span>Имя</span><input id="editFirstName" required /></label>
            <label><span>Фамилия</span><input id="editLastName" required /></label>
          </div>
          <div class="edit-choice-grid">
            <label class="edit-choice"><input id="editHasBs" type="checkbox" /><span><b>Business Session</b><small>участие в БС</small></span></label>
            <label class="edit-choice"><input id="editHasCorporate" type="checkbox" /><span><b>Корпоратив</b><small>участие в корпоративе</small></span></label>
          </div>
          <label id="editOvernightWrap" class="toggle-row hidden"><input id="editOvernight" type="checkbox" /><span><b>С ночёвкой 💤</b><small>+500 ₽ к корпоративу</small></span></label>
          <div id="editComplimentary" class="edit-complimentary hidden">⭐ Бесплатная регистрация: изменение списков и ночёвки не добавит оплату.</div>
          <button id="editParticipantSubmit" class="primary-button" type="submit"><span>Сохранить изменения</span></button>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-close-edit]')) closeEditModal();
    });
    $('editHasCorporate').addEventListener('change', syncEditOvernight);
    $('editParticipantForm').addEventListener('submit', saveParticipantEdit);
  }

  function closeEditModal() {
    const modal = $('editParticipantModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    currentEditState = null;
  }

  function syncEditOvernight() {
    const hasCorp = $('editHasCorporate')?.checked;
    $('editOvernightWrap')?.classList.toggle('hidden', !hasCorp);
    if (!hasCorp && $('editOvernight')) $('editOvernight').checked = false;
  }

  function decorateParticipantRows() {
    if (!$('adminApp')) return;
    let added = false;
    document.querySelectorAll('#bsParticipants [data-remove-registration], #corpParticipants [data-remove-registration]').forEach(remove => {
      const actions = remove.closest('.participant-actions');
      if (!actions || actions.querySelector('[data-edit-registration]')) return;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini-button';
      edit.dataset.editRegistration = remove.dataset.removeRegistration;
      edit.title = 'Редактировать участника';
      edit.setAttribute('aria-label', 'Редактировать участника');
      edit.innerHTML = '<i data-lucide="pencil"></i>';
      actions.insertBefore(edit, actions.firstChild);
      added = true;
    });
    if (added) window.lucide?.createIcons();
  }

  function queueParticipantDecoration() {
    if (participantDecorateQueued) return;
    participantDecorateQueued = true;
    requestAnimationFrame(() => {
      participantDecorateQueued = false;
      decorateParticipantRows();
    });
  }

  async function openParticipantEdit(registrationId, button) {
    if (!adminPassword()) return toast('Нужно войти заново', 'error');
    button.disabled = true;
    try {
      const state = await rpc('admin_get_participant_by_registration', {
        p_password: adminPassword(),
        p_registration_id: registrationId
      });
      if (!state) throw new Error('PARTICIPANT_NOT_FOUND');
      currentEditState = state;
      $('editFirstName').value = state.first_name || '';
      $('editLastName').value = state.last_name || '';
      const regs = Array.isArray(state.registrations) ? state.registrations : [];
      const bs = regs.find(r => r.event_type === 'bs');
      const corp = regs.find(r => r.event_type === 'corporate');
      $('editHasBs').checked = Boolean(bs);
      $('editHasCorporate').checked = Boolean(corp);
      $('editOvernight').checked = Boolean(corp?.overnight);
      $('editComplimentary').classList.toggle('hidden', !state.is_complimentary);
      syncEditOvernight();
      $('editParticipantModal').classList.add('open');
      $('editParticipantModal').setAttribute('aria-hidden', 'false');
      setTimeout(() => $('editFirstName').focus(), 80);
    } catch (error) {
      console.error(error);
      toast('Не удалось открыть участника', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function saveParticipantEdit(event) {
    event.preventDefault();
    if (!currentEditState) return;
    if (!$('editHasBs').checked && !$('editHasCorporate').checked) return toast('Оставь хотя бы один список', 'error');
    const button = $('editParticipantSubmit');
    button.disabled = true;
    const old = button.innerHTML;
    button.innerHTML = '<span>Сохраняем…</span>';
    try {
      await rpc('admin_edit_participant', {
        p_password: adminPassword(),
        p_participant_id: currentEditState.participant_id,
        p_first_name: $('editFirstName').value.trim(),
        p_last_name: $('editLastName').value.trim(),
        p_has_bs: $('editHasBs').checked,
        p_has_corporate: $('editHasCorporate').checked,
        p_overnight: $('editHasCorporate').checked && $('editOvernight').checked
      });
      closeEditModal();
      toast('Изменения сохранены ✓');
      setTimeout(() => location.reload(), 450);
    } catch (error) {
      console.error(error);
      toast('Не удалось сохранить изменения', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = old;
    }
  }

  function installUndoButton() {
    const toolbar = document.querySelector('#view-finance .section-toolbar');
    if (!toolbar || $('undoLastAction')) return;
    const wrap = document.createElement('div');
    wrap.className = 'undo-wrap';
    wrap.innerHTML = `
      <button id="undoLastAction" class="primary-button compact undo-last-button" type="button" disabled><span>↩️ Отменить последнее</span></button>
      <small id="undoLastCaption" class="undo-caption">Проверяем последнюю операцию…</small>`;
    toolbar.appendChild(wrap);
    $('undoLastAction').addEventListener('click', undoLastAction);
    refreshUndoAction();
  }

  async function refreshUndoAction() {
    const button = $('undoLastAction');
    const caption = $('undoLastCaption');
    if (!button || !caption || undoBusy || !adminPassword()) return;
    try {
      const action = await rpc('admin_last_action', { p_password: adminPassword() });
      button.dataset.actionTitle = action?.title || '';
      button.disabled = !action;
      caption.textContent = action ? `Последнее: ${action.title}` : 'Нет действий, которые можно отменить';
    } catch (error) {
      console.error(error);
      button.disabled = true;
      caption.textContent = 'Не удалось получить последнюю операцию';
    }
  }

  function scheduleUndoRefresh() {
    clearTimeout(undoRefreshTimer);
    undoRefreshTimer = setTimeout(refreshUndoAction, 400);
  }

  async function undoLastAction() {
    const button = $('undoLastAction');
    if (!button || button.disabled || undoBusy) return;
    const title = button.dataset.actionTitle || 'последнее действие';
    if (!confirm(`Отменить последнее действие?\n\n${title}\n\nБаланс и состояние участника будут восстановлены автоматически.`)) return;
    undoBusy = true;
    button.disabled = true;
    const old = button.innerHTML;
    button.innerHTML = '<span>Отменяем…</span>';
    try {
      const result = await rpc('admin_undo_last_action', { p_password: adminPassword() });
      toast(`Отменено: ${result?.title || title} ↩️`);
      setTimeout(() => location.reload(), 550);
    } catch (error) {
      console.error(error);
      toast(/NOTHING_TO_UNDO/i.test(error?.message || '') ? 'Нет действий для отмены' : 'Не удалось отменить действие', 'error');
      button.innerHTML = old;
      undoBusy = false;
      refreshUndoAction();
    }
  }

  function installNavigationFallback() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      const view = button.dataset.view;
      if (!view || !$(`view-${view}`)) return;
      document.querySelectorAll('.view-section').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
      document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    }, true);
  }

  function setupAdminEnhancements() {
    if (!$('adminApp') || !db) return;
    installStyles();
    createEditModal();
    installUndoButton();
    decorateParticipantRows();
    installNavigationFallback();

    ['bsParticipants', 'corpParticipants'].forEach(id => {
      const node = $(id);
      if (!node) return;
      const observer = new MutationObserver(queueParticipantDecoration);
      observer.observe(node, { childList: true, subtree: false });
    });

    ['recentOperations', 'operationsHistory'].forEach(id => {
      const node = $(id);
      if (!node) return;
      const observer = new MutationObserver(scheduleUndoRefresh);
      observer.observe(node, { childList: true, subtree: false });
    });

    const appObserver = new MutationObserver(() => {
      if (!$('adminApp').classList.contains('hidden')) {
        queueParticipantDecoration();
        installInstallButton();
        scheduleUndoRefresh();
      }
    });
    appObserver.observe($('adminApp'), { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('click', e => {
      const edit = e.target.closest('[data-edit-registration]');
      if (edit) openParticipantEdit(edit.dataset.editRegistration, edit);
    });
  }

  setupPWA();
  installStyles();
  setupAdminEnhancements();
  setTimeout(installInstallButton, 500);
})();
