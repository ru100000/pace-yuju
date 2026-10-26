'use strict';

/* Email login + account-scoped history. The app still works as a local-only
 * guest when firebase-config.js has not been filled in yet. */
(() => {
  const BASE_KEY = 'campus-move-history-v1';
  const config = window.PACE_FIREBASE_CONFIG || {};
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const configured = required.every(key => typeof config[key] === 'string' && config[key].trim() && !config[key].includes('請填入'));
  const subscribers = new Set();
  let state = { ready: false, configured, user: null, records: [], error: '' };
  let auth = null;
  let db = null;

  const localKey = uid => uid ? `${BASE_KEY}:user:${uid}` : BASE_KEY;
  function readLocal(uid) {
    try {
      const value = JSON.parse(localStorage.getItem(localKey(uid)) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function writeLocal(uid, rows) {
    localStorage.setItem(localKey(uid), JSON.stringify(rows));
  }
  function emit(next) {
    state = {...state, ...next};
    subscribers.forEach(fn => fn(state));
  }
  function cleanRecord(record) {
    return JSON.parse(JSON.stringify(record));
  }
  function collection(uid) {
    return db.collection('users').doc(uid).collection('records');
  }
  async function loadCloud(user) {
    const snapshot = await collection(user.uid).orderBy('date', 'desc').get();
    const rows = snapshot.docs.map(doc => doc.data()).filter(row => row && row.id !== undefined);
    writeLocal(user.uid, rows);
    return rows;
  }
  async function migrateGuest(user, rows) {
    if (!rows.length) return [];
    const batch = db.batch();
    rows.forEach(row => batch.set(collection(user.uid).doc(String(row.id)), cleanRecord(row)));
    await batch.commit();
    writeLocal(user.uid, rows);
    return rows;
  }
  async function loadForUser(user) {
    if (!user || !db) return readLocal(user?.uid);
    try {
      const rows = await loadCloud(user);
      if (!rows.length) {
        const guestRows = readLocal();
        if (guestRows.length) return migrateGuest(user, guestRows);
      }
      return rows;
    } catch (error) {
      const cached = readLocal(user.uid);
      emit({error: `雲端紀錄暫時無法讀取，先顯示本機快取：${error.message || ''}`});
      return cached;
    }
  }
  async function saveRecords(rows) {
    const uid = state.user?.uid;
    writeLocal(uid, rows);
    if (!uid || !db) return;
    const ref = collection(uid);
    const current = await ref.get();
    const nextIds = new Set(rows.map(row => String(row.id)));
    const batch = db.batch();
    current.docs.forEach(doc => { if (!nextIds.has(doc.id)) batch.delete(doc.ref); });
    rows.forEach(row => batch.set(ref.doc(String(row.id)), cleanRecord(row)));
    await batch.commit();
  }
  async function signIn(email, password, register) {
    if (!configured || !auth) throw new Error('請先完成 firebase-config.js 設定，再啟用帳號登入。');
    if (register) await auth.createUserWithEmailAndPassword(email, password);
    else await auth.signInWithEmailAndPassword(email, password);
  }
  function notice(text) {
    const dialog = document.createElement('dialog');
    dialog.className = 'auth-notice';
    dialog.innerHTML = `<div class="dialog-head"><div><span class="overline">ACCOUNT</span><h2>帳號登入</h2></div><button class="close" aria-label="關閉">×</button></div><p>${text}</p><button class="primary">知道了</button>`;
    document.body.append(dialog);
    dialog.querySelectorAll('button').forEach(button => button.onclick = () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    dialog.showModal();
  }
  function installUI() {
    const topRight = document.querySelector('.topright');
    if (!topRight) return;
    const control = document.createElement('div');
    control.className = 'account-control';
    control.innerHTML = '<span class="account-avatar" aria-hidden="true">?</span><div class="account-copy"><strong class="account-name">訪客模式</strong><small class="account-state">紀錄只存在此裝置</small></div><button class="account-button" type="button">登入／註冊</button>';
    topRight.prepend(control);
    const avatar = control.querySelector('.account-avatar');
    const name = control.querySelector('.account-name');
    const status = control.querySelector('.account-state');
    const button = control.querySelector('.account-button');
    button.onclick = () => openLogin();
    control.addEventListener('click', event => {
      if (event.target === button || !state.user) return;
      if (confirm('要登出目前的 Google 帳號嗎？')) auth.signOut();
    });
    subscribers.add(next => {
      if (next.user) {
        avatar.textContent = (next.user.displayName || next.user.email || 'G').slice(0, 1).toUpperCase();
        name.textContent = next.user.displayName || next.user.email || 'Google 使用者';
        status.textContent = next.error || '紀錄已同步到雲端';
        button.textContent = '登出';
        button.onclick = () => auth.signOut();
      } else {
        avatar.textContent = '?';
        name.textContent = '訪客模式';
        status.textContent = next.configured ? '登入後跨裝置保存紀錄' : '紀錄只存在此裝置';
        button.textContent = '登入／註冊';
        button.onclick = () => openLogin();
      }
    });
    if (!configured) button.title = '請先完成 Firebase 設定';

    function openLogin() {
      const dialog = document.createElement('dialog');
      dialog.className = 'auth-notice';
      dialog.innerHTML = '<div class="dialog-head"><div><span class="overline">ACCOUNT</span><h2>登入或註冊</h2></div><button class="close" type="button" aria-label="關閉">×</button></div><p>使用 Email 與密碼保存你的運動紀錄。密碼由 Firebase 安全處理。</p><form><label>Email<input type="email" autocomplete="email" required></label><label>密碼<input type="password" minlength="6" autocomplete="current-password" required></label><div class="controls"><button class="primary" type="submit">登入</button><button type="button" class="account-button register">建立帳號</button></div></form>';
      document.body.append(dialog);
      const form = dialog.querySelector('form');
      const email = form.querySelector('input[type="email"]');
      const password = form.querySelector('input[type="password"]');
      const submit = form.querySelector('button[type="submit"]');
      const register = form.querySelector('.register');
      const close = () => { dialog.close(); dialog.remove(); };
      dialog.querySelector('.close').onclick = close;
      form.onsubmit = async event => {
        event.preventDefault();
        submit.disabled = true;
        register.disabled = true;
        try { await signIn(email.value.trim(), password.value, false); close(); }
        catch (error) { notice(error.message || '登入失敗，請檢查 Email 與密碼。'); submit.disabled = false; register.disabled = false; }
      };
      register.onclick = async () => {
        if (!form.reportValidity()) return;
        submit.disabled = true;
        register.disabled = true;
        try { await signIn(email.value.trim(), password.value, true); close(); }
        catch (error) { notice(error.message || '註冊失敗，請確認資料後重試。'); submit.disabled = false; register.disabled = false; }
      };
      dialog.addEventListener('cancel', close, {once: true});
      dialog.showModal();
    }
  }
  window.PaceAuth = {
    onChange(fn) { subscribers.add(fn); if (state.ready) fn(state); return () => subscribers.delete(fn); },
    getRecords() { return state.records; },
    saveRecords,
    signIn,
    signOut() { return auth?.signOut(); },
    isConfigured() { return configured; }
  };
  function boot() {
    installUI();
    if (!configured || !window.firebase?.auth || !window.firebase?.firestore) {
      emit({ready: true, records: readLocal()});
      return;
    }
    try {
      firebase.initializeApp(config);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged(async user => {
        emit({ready: false, user, error: ''});
        const records = await loadForUser(user);
        emit({ready: true, user, records});
      });
    } catch (error) {
      emit({ready: true, records: readLocal(), error: `Firebase 初始化失敗：${error.message || ''}`});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
