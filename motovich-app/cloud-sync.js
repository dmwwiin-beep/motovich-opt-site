/* MOTOVICH Cloud Sync — opt-in, explicit push/pull to a user-owned Supabase project. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const CONFIG_KEY = 'motovich.cloud.config';
  const SESSION_KEY = 'motovich.cloud.session';
  const PRE_PULL_KEY = KEY + '.beforeCloudPull';
  const MAX_STATE_BYTES = 2 * 1024 * 1024;
  let config = readJson(CONFIG_KEY, null);
  let session = readJson(SESSION_KEY, null);
  let busy = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch (_) { return fallback; }
  }
  function persistJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function showStatus(message, type) {
    const node = $('cloudStatus');
    if (!node) return;
    node.textContent = message;
    node.className = 'cloud-status' + (type ? ' ' + type : '');
  }
  function accountLabel() {
    const node = $('cloudAccount');
    if (node) node.textContent = session?.user?.email ? 'Аккаунт: ' + session.user.email : 'Не выполнен вход';
  }
  function secretLikeKey(value) {
    if (/^sb_secret_/i.test(value)) return true;
    const parts = value.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role === 'service_role') return true;
      } catch (_) {}
    }
    return false;
  }
  function validatedConfig(urlText, keyText) {
    let url;
    try { url = new URL(urlText.trim()); } catch (_) { throw new Error('Проверь адрес проекта Supabase.'); }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Для облака нужен HTTPS-адрес Supabase.');
    }
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Укажи корневой адрес проекта без путей и параметров.');
    }
    const publicKey = keyText.trim();
    if (publicKey.length < 12) throw new Error('Вставь публичный anon/publishable key проекта.');
    if (secretLikeKey(publicKey)) throw new Error('Секретный/service_role ключ нельзя хранить в браузере. Нужен только публичный ключ.');
    return { url: url.origin, anonKey: publicKey };
  }
  // Validate locally stored connection settings before trusting them on startup.
  if (config) {
    try { config = validatedConfig(String(config.url || ''), String(config.anonKey || '')); }
    catch (_) { config = null; localStorage.removeItem(CONFIG_KEY); }
  }
  if (!session || typeof session.access_token !== 'string' ||
      typeof session.refresh_token !== 'string' || typeof session.user?.id !== 'string') {
    session = null;
    localStorage.removeItem(SESSION_KEY);
  }

  function validateState(data) {
    const arrays = ['tasks', 'habits', 'goals', 'journal'];
    if (!data || typeof data !== 'object' || Array.isArray(data) || !arrays.every(k => Array.isArray(data[k]))) {
      throw new Error('Формат данных не поддерживается этой версией MOTOVICH.');
    }
    if (data.tasks.length > 2000 || data.habits.length > 200 || data.goals.length > 500 || data.journal.length > 5000) {
      throw new Error('Слишком много записей для безопасной синхронизации.');
    }
    if (![...data.tasks, ...data.habits, ...data.goals, ...data.journal].every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      throw new Error('В данных найдена повреждённая запись.');
    }
    const size = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if (size > MAX_STATE_BYTES) throw new Error('Объём данных превышает 2 МБ.');
    return size;
  }
  function normalizeState(data) {
    validateState(data);
    const out = {
      waterLog: {}, quickNotes: [], weeklyReviews: {}, focusHistory: [],
      taskCategories: ['Бизнес', 'Работа', 'Личное', 'Здоровье', 'Учёба', 'Дом', 'Другое'],
      waterTarget: 8, profileName: '', focusMinutesTotal: 0, routines: [],
      routineLog: {}, achievements: {}, energyHistory: {}, pinnedTasks: [],
      ...defaultState(), ...data, schemaVersion: 2
    };
    for (const key of ['tasks', 'habits', 'goals', 'journal', 'taskHistory', 'wellbeingHistory', 'focusHistory', 'quickNotes']) {
      if (!Array.isArray(out[key])) out[key] = [];
      else out[key] = out[key].filter(x => x && typeof x === 'object' && !Array.isArray(x));
    }
    if (!Array.isArray(out.taskCategories) || !out.taskCategories.every(x => typeof x === 'string')) {
      out.taskCategories = ['Бизнес', 'Работа', 'Личное', 'Здоровье', 'Учёба', 'Дом', 'Другое'];
    }
    if (!Array.isArray(out.pinnedTasks)) out.pinnedTasks = [];
    else out.pinnedTasks = out.pinnedTasks.filter(x => typeof x === 'string').slice(0, 3);
    if (!Array.isArray(out.routines)) out.routines = [];
    out.routines = out.routines.filter(x => x && typeof x === 'object' && !Array.isArray(x))
      .map((r, i) => ({ id: String(r.id || 'routine-' + i), name: String(r.name || 'Рутина').slice(0, 80),
        items: Array.isArray(r.items) ? r.items.filter(s => typeof s === 'string').slice(0, 30) : [] })).slice(0, 50);
    for (const key of ['habitHistory', 'preferences', 'wellbeing', 'waterLog', 'weeklyReviews', 'routineLog', 'achievements', 'energyHistory']) {
      if (!out[key] || typeof out[key] !== 'object' || Array.isArray(out[key])) out[key] = {};
    }
    out.preferences = { accent: '#c3f36b', ...out.preferences };
    out.wellbeing = { sleep: 8, mood: 'Спокойное', move: 30, ...out.wellbeing };
    out.waterTarget = Math.min(30, Math.max(1, Number(out.waterTarget) || 8));
    out.cycles = Math.max(0, Number(out.cycles) || 0);
    out.energy = Math.min(5, Math.max(1, Number(out.energy) || 3));
    out.focusMinutesTotal = Math.max(0, Number(out.focusMinutesTotal) || 0);
    out.profileName = typeof out.profileName === 'string' ? out.profileName.slice(0, 50) : '';
    if (typeof out.calendarMonth !== 'string' || !/^\\d{4}-\\d{2}$/.test(out.calendarMonth)) out.calendarMonth = dateKey().slice(0, 7);
    if (typeof out.habitDate !== 'string') out.habitDate = dateKey();
    return out;
  }
  function updateButtons() {
    const configured = !!(config?.url && config?.anonKey);
    const signedIn = !!(session?.access_token && session?.user?.id);
    ['cloudSignUp', 'cloudSignIn', 'cloudCheck'].forEach(id => { if ($(id)) $(id).disabled = busy || !configured; });
    ['cloudSignOut', 'cloudPush', 'cloudPull'].forEach(id => { if ($(id)) $(id).disabled = busy || !configured || !signedIn; });
    if ($('cloudSaveConfig')) $('cloudSaveConfig').disabled = busy;
    if ($('cloudRestoreLocal')) $('cloudRestoreLocal').disabled = busy || !localStorage.getItem(PRE_PULL_KEY);
    accountLabel();
  }
  function configReady() {
    return !!(config && typeof config.url === 'string' && typeof config.anonKey === 'string');
  }
  function baseHeaders(withSession = true) {
    if (!configReady()) throw new Error('Сначала сохрани адрес и публичный ключ Supabase.');
    const headers = { apikey: config.anonKey, 'Content-Type': 'application/json' };
    if (withSession && session?.access_token) headers.Authorization = 'Bearer ' + session.access_token;
    return headers;
  }
  async function refreshSession() {
    if (!session?.refresh_token || !configReady()) return false;
    const response = await fetch(config.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: baseHeaders(false),
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token || !data.refresh_token || !data.user) {
      session = null;
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    session = data;
    persistJson(SESSION_KEY, session);
    updateButtons();
    return true;
  }
  async function request(path, options = {}, retry = true) {
    const headers = { ...baseHeaders(options.withSession !== false), ...(options.headers || {}) };
    const init = { method: options.method || 'GET', headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    init.signal = AbortSignal.timeout(20_000);
    const response = await fetch(config.url + path, init);
    if (response.status === 401 && retry && session?.refresh_token && await refreshSession()) {
      return request(path, options, false);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || ('HTTP ' + response.status);
      throw new Error(String(message).slice(0, 260));
    }
    return data;
  }
  function setBusy(value) {
    busy = value;
    updateButtons();
  }
  function friendlyError(error) {
    const text = error instanceof Error ? error.message : 'Неизвестная ошибка';
    showStatus('Ошибка: ' + text, 'error');
  }
  async function runAction(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); }
    catch (error) { friendlyError(error); }
    finally { setBusy(false); }
  }
  function downloadLocalSafetyCopy() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'motovich-before-cloud-pull-' + dateKey() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function getRemoteState() {
    const result = await request('/rest/v1/motovich_user_state?select=state,schema_version,revision,updated_at&user_id=eq.' + encodeURIComponent(session.user.id) + '&limit=1');
    return Array.isArray(result) ? result[0] || null : null;
  }
  async function signUp() {
    const email = $('cloudEmail').value.trim();
    const password = $('cloudPassword').value;
    if (!email || !password) throw new Error('Введи email и пароль.');
    if (password.length < 10) throw new Error('Для облачного аккаунта используй пароль длиной не менее 10 символов.');
    const result = await request('/auth/v1/signup', { method: 'POST', withSession: false, body: { email, password } }, false);
    $('cloudPassword').value = '';
    if (result.access_token && result.refresh_token && result.user) {
      session = result;
      if (!persistJson(SESSION_KEY, session)) { session = null; throw new Error('Не удалось сохранить сессию в браузере.'); }
      showStatus('Аккаунт создан; вход выполнен.', 'success');
    } else {
      showStatus('Запрос на регистрацию отправлен. Подтверди email, затем выполни вход.', 'success');
    }
    updateButtons();
  }
  async function signIn() {
    const email = $('cloudEmail').value.trim();
    const password = $('cloudPassword').value;
    if (!email || !password) throw new Error('Введи email и пароль.');
    const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', withSession: false, body: { email, password } }, false);
    if (!result.access_token || !result.refresh_token || !result.user?.id) throw new Error('Supabase не вернул действующую сессию.');
    session = result;
    if (!persistJson(SESSION_KEY, session)) { session = null; throw new Error('Браузеру не удалось сохранить сессию. Освободи место в хранилище.'); }
    $('cloudPassword').value = '';
    showStatus('Вход выполнен. Данные пока не отправлены в облако.', 'success');
    updateButtons();
  }
  async function signOut() {
    try { if (session?.access_token) await request('/auth/v1/logout', { method: 'POST', body: {} }, false); }
    finally {
      session = null;
      localStorage.removeItem(SESSION_KEY);
      showStatus('Выход выполнен. Локальные данные не удалены.', 'success');
      updateButtons();
    }
  }
  async function checkConnection() {
    await request('/auth/v1/settings', { withSession: false }, false);
    showStatus('Связь с Supabase работает. Теперь можно войти или создать аккаунт.', 'success');
  }
  async function pushLocalState() {
    validateState(state);
    const existing = await getRemoteState();
    const warning = existing
      ? 'В облаке уже есть сохранение от ' + new Date(existing.updated_at).toLocaleString('ru-RU') + ' (ревизия ' + existing.revision + '). Отправка заменит его текущими локальными данными. Продолжить?'
      : 'Отправить текущие локальные данные в облако?';
    if (!confirm(warning)) return;
    const saved = await request('/rest/v1/motovich_user_state?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: { user_id: session.user.id, state, schema_version: 2 }
    });
    const row = Array.isArray(saved) ? saved[0] : saved;
    showStatus('Выгрузка завершена · ревизия ' + (row?.revision ?? 'сохранена') + (row?.updated_at ? ' · ' + new Date(row.updated_at).toLocaleString('ru-RU') : ''), 'success');
  }
  async function pullRemoteState() {
    const row = await getRemoteState();
    if (!row) { showStatus('В облаке пока нет сохранения. Сначала отправь локальные данные.', ''); return; }
    if (!confirm('Загрузить облачные данные от ' + new Date(row.updated_at).toLocaleString('ru-RU') + '? Текущие данные на этом устройстве будут заменены. Перед заменой приложение создаст локальную точку восстановления и попытается скачать JSON-копию.')) return;
    const normalized = normalizeState(row.state);
    const snapshot = { savedAt: new Date().toISOString(), data: state };
    if (!persistJson(PRE_PULL_KEY, snapshot)) throw new Error('Не удалось сохранить точку восстановления. Освободи место в браузере.');
    try { downloadLocalSafetyCopy(); } catch (_) {}
    state = normalized;
    persist();
    render();
    showStatus('Загрузка завершена · облачная ревизия ' + row.revision + '. Локальные данные до загрузки сохранены.', 'success');
    updateButtons();
  }
  function restorePrePullState() {
    const snapshot = readJson(PRE_PULL_KEY, null);
    if (!snapshot || !snapshot.data) throw new Error('Точка восстановления не найдена.');
    const normalized = normalizeState(snapshot.data);
    if (!confirm('Вернуть локальные данные, сохранённые до последней загрузки из облака?')) return;
    state = normalized;
    persist();
    render();
    showStatus('Предыдущие локальные данные восстановлены.', 'success');
    updateButtons();
  }

  const settings = $('settings');
  const card = settings?.querySelector('.card');
  if (!card || $('cloudConfigPanel')) return;

  const styles = document.createElement('style');
  styles.textContent = '.cloud-panel{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}.cloud-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cloud-panel input{min-width:0}.cloud-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cloud-actions button{flex:1 1 130px}.cloud-status{font-size:12px;line-height:1.5;color:var(--muted);margin:8px 0;overflow-wrap:anywhere}.cloud-status.error{color:var(--red)}.cloud-status.success{color:var(--accent)}.cloud-warning{font-size:11px;color:var(--muted);line-height:1.5}@media(max-width:520px){.cloud-grid{grid-template-columns:1fr}}';
  document.head.appendChild(styles);

  const panel = document.createElement('div');
  panel.id = 'cloudConfigPanel';
  panel.className = 'cloud-panel';
  panel.innerHTML = `
    <h3>Облако и синхронизация</h3>
    <p class="muted">По умолчанию данные остаются в этом браузере. Подключение работает только после настройки собственного проекта Supabase и применения миграции из репозитория.</p>
    <label class="small" for="cloudProjectUrl">URL проекта Supabase</label>
    <input id="cloudProjectUrl" class="field" type="url" autocomplete="url" placeholder="https://your-project.supabase.co">
    <label class="small" for="cloudPublicKey" style="display:block;margin-top:8px">Публичный anon/publishable key</label>
    <input id="cloudPublicKey" class="field" type="password" autocomplete="off" placeholder="Публичный ключ, не service_role">
    <div class="cloud-actions"><button id="cloudSaveConfig" class="advanced-button" type="button">Сохранить подключение</button><button id="cloudCheck" class="advanced-button" type="button">Проверить связь</button></div>
    <p class="cloud-warning">Никогда не вставляй сюда OpenAI API key или Supabase secret/service_role. Эти поля сохраняются только в локальном браузере. Для реального запуска нужна серверная настройка из папки supabase/.</p>
    <div id="cloudAccount" class="small" style="margin-top:12px">Не выполнен вход</div>
    <div class="cloud-grid" style="margin-top:8px">
      <div><label class="small" for="cloudEmail">Email</label><input id="cloudEmail" class="field" type="email" autocomplete="email" placeholder="you@example.com"></div>
      <div><label class="small" for="cloudPassword">Пароль аккаунта</label><input id="cloudPassword" class="field" type="password" autocomplete="current-password" minlength="10" placeholder="Не менее 10 символов"></div>
    </div>
    <div class="cloud-actions"><button id="cloudSignUp" class="advanced-button" type="button">Создать аккаунт</button><button id="cloudSignIn" class="advanced-button" type="button">Войти</button><button id="cloudSignOut" class="advanced-button" type="button">Выйти</button></div>
    <div class="cloud-actions"><button id="cloudPush" class="advanced-button" type="button">Отправить локальные данные</button><button id="cloudPull" class="advanced-button" type="button">Загрузить из облака</button></div>
    <div class="cloud-actions"><button id="cloudRestoreLocal" class="advanced-button" type="button">Вернуть локальные данные до загрузки</button></div>
    <p id="cloudStatus" class="cloud-status" role="status" aria-live="polite">Облако не подключено. Локальный режим работает независимо.</p>
  `;
  card.appendChild(panel);

  if (config) {
    $('cloudProjectUrl').value = config.url || '';
    $('cloudPublicKey').value = config.anonKey || '';
  }

  $('cloudSaveConfig').addEventListener('click', () => runAction(async () => {
    const next = validatedConfig($('cloudProjectUrl').value, $('cloudPublicKey').value);
    if (config && (config.url !== next.url || config.anonKey !== next.anonKey)) {
      session = null;
      localStorage.removeItem(SESSION_KEY);
    }
    config = next;
    if (!persistJson(CONFIG_KEY, config)) throw new Error('Не удалось сохранить настройки облака в браузере.');
    showStatus('Параметры сохранены локально. Нажми «Проверить связь», затем выполни вход.', 'success');
    updateButtons();
  }));
  $('cloudCheck').addEventListener('click', () => runAction(checkConnection));
  $('cloudSignUp').addEventListener('click', () => runAction(signUp));
  $('cloudSignIn').addEventListener('click', () => runAction(signIn));
  $('cloudSignOut').addEventListener('click', () => runAction(signOut));
  $('cloudPush').addEventListener('click', () => runAction(pushLocalState));
  $('cloudPull').addEventListener('click', () => runAction(pullRemoteState));
  $('cloudRestoreLocal').addEventListener('click', () => runAction(restorePrePullState));

  if (session && configReady()) {
    // Check/refresh the stored session, but don't upload or download data automatically.
    refreshSession().then(ok => {
      if (!ok) showStatus('Сессия истекла. Войди снова; локальные данные сохранены.', '');
      else showStatus('Аккаунт подключён. Выбери направление синхронизации вручную.', 'success');
      updateButtons();
    }).catch(() => {
      showStatus('Не удалось проверить сессию. Локальные данные доступны.', 'error');
      updateButtons();
    });
  } else {
    session = null;
    localStorage.removeItem(SESSION_KEY);
  }
  updateButtons();
})();
