'use strict';

/* Email login + account-scoped history. The app still works as a local-only
 * guest when firebase-config.js has not been filled in yet. */
(() => {
  const BASE_KEY = 'campus-move-history-v1';
  const config = window.PACE_FIREBASE_CONFIG || {};
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const configured = required.every(key => typeof config[key] === 'string' && config[key].trim() && !config[key].includes('請填入'));
  const subscribers = new Set();
  let state = { ready: false, configured, user: null, records: [], profile: {}, error: '' };
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
  const profileKey = uid => `${BASE_KEY}:profile:${uid || 'guest'}`;
  function readProfile(uid) {
    try {
      const value = JSON.parse(localStorage.getItem(profileKey(uid)) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  function writeProfile(uid, profile) {
    localStorage.setItem(profileKey(uid), JSON.stringify(profile));
  }
  const friendsKey = uid => `${BASE_KEY}:friends:${uid || 'guest'}`;
  function readFriends(uid) {
    try {
      const value = JSON.parse(localStorage.getItem(friendsKey(uid)) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function writeFriends(uid, friends) {
    localStorage.setItem(friendsKey(uid), JSON.stringify(friends));
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
    emit({records: rows});
    if (!uid || !db) return;
    const ref = collection(uid);
    const current = await ref.get();
    const nextIds = new Set(rows.map(row => String(row.id)));
    const batch = db.batch();
    current.docs.forEach(doc => { if (!nextIds.has(doc.id)) batch.delete(doc.ref); });
    rows.forEach(row => batch.set(ref.doc(String(row.id)), cleanRecord(row)));
    await batch.commit();
  }
  async function loadProfile(user) {
    const cached = readProfile(user?.uid);
    if (!user || !db) return cached;
    try {
      const snapshot = await db.collection('users').doc(user.uid).get();
      const profile = snapshot.exists ? snapshot.data() : cached;
      writeProfile(user.uid, profile);
      return profile;
    } catch (error) {
      emit({error: `個人資料暫時無法同步，先顯示本機資料：${error.message || ''}`});
      return cached;
    }
  }
  async function saveProfile(profile) {
    const uid = state.user?.uid;
    writeProfile(uid, profile);
    if (uid && db) {
      await db.collection('users').doc(uid).set(profile, {merge: true});
      await db.collection('publicProfiles').doc(uid).set({name: profile.name || '', avatar: profile.avatar || '', email: state.user.email || ''}, {merge: true});
    }
    emit({profile});
  }
  function readAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('頭貼讀取失敗，請換一張圖片。'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('頭貼格式無法讀取，請使用 JPG 或 PNG。'));
        image.onload = () => {
          const size = 160, scale = Math.min(size / image.width, size / image.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', .82));
        };
        image.src = reader.result;
        installFriendsUI();

        function installFriendsUI() {
          const sessionTop = null;
          if (!sessionTop || sessionTop.querySelector('.friends-button')) return;
          const friendsButton = document.createElement('button');
          friendsButton.className = 'friends-button';
          friendsButton.type = 'button';
          friendsButton.textContent = '好友';
          friendsButton.onclick = openFriends;
          sessionTop.append(friendsButton);
        }

        function openFriends() {
          const dialog = document.createElement('dialog');
          dialog.className = 'friends-notice';
          dialog.innerHTML = '<div class="profile-heading"><div><span class="overline">PACE CIRCLE</span><h2>我的好友</h2><p>把一起運動的人，放進你的圈子。</p></div><button class="close" type="button" aria-label="關閉">×</button></div><div class="friends-body"><form class="friends-form"><label>好友暱稱或 Email<input name="friend" maxlength="60" placeholder="例如：小安／name@example.com" required><button class="profile-save primary" type="submit">新增好友</button></label></form><p class="friends-note">目前好友清單保存在這台裝置；登入與雲端邀請功能可再接續設定。</p><div class="friends-list"></div></div>';
          document.body.append(dialog);
          const list = dialog.querySelector('.friends-list');
          const social = document.createElement('div');
          social.innerHTML = '<style>.social-panels{display:grid;gap:10px;margin-top:18px}.social-panel{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid #e0e5da;border-radius:10px;background:#f7f9f3}.social-panel h3{margin:0 0 3px;color:#5d6e59;font-size:12px}.social-panel p{margin:0;color:#8a9581;font-size:10px;line-height:1.6}.social-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#dfe7d3;color:#667655;font-size:16px;flex-shrink:0}.social-panel button{margin-top:8px;border:1px solid #d5ddcc;border-radius:6px;padding:5px 8px;background:#fff;color:#6b7b68;font-size:10px}</style><div class="social-panels"><section class="social-panel"><span class="social-icon">✦</span><div><h3>可能認識的人</h3><p>登入並加入班級後，會依共同課程與共同好友推薦對象。</p><button type="button" disabled>等待好友同步</button></div></section><section class="social-panel"><span class="social-icon">↗</span><div><h3>本週運動排行</h3><p>好友同步後，這裡會顯示本週距離與運動時間排名。</p><button type="button" disabled>尚未開始排行</button></div></section></div>';
          dialog.querySelector('.friends-body').append(social);
          const form = dialog.querySelector('form');
          const input = form.elements.friend;
          const close = () => { dialog.close(); dialog.remove(); };
          dialog.querySelector('.close').onclick = close;
          const renderFriends = () => {
            const friends = readFriends(state.user?.uid);
            list.replaceChildren();
            if (!friends.length) { list.innerHTML = '<p class="friends-empty">還沒有好友，先新增一位一起運動的夥伴。</p>'; return; }
            friends.forEach((friend, index) => {
              const item = document.createElement('div');
              item.className = 'friend-item';
              item.innerHTML = `<span class="friend-avatar">${friend.slice(0, 1).toUpperCase()}</span><strong></strong><button type="button" aria-label="移除好友">移除</button>`;
              item.querySelector('strong').textContent = friend;
              item.querySelector('button').onclick = () => { const next = readFriends(state.user?.uid); next.splice(index, 1); writeFriends(state.user?.uid, next); renderFriends(); };
              list.append(item);
            });
          };
          form.onsubmit = event => { event.preventDefault(); const friend = input.value.trim(); if (!friend) return; const friends = readFriends(state.user?.uid); if (!friends.includes(friend)) friends.push(friend); writeFriends(state.user?.uid, friends); input.value = ''; renderFriends(); };
          dialog.addEventListener('cancel', close, {once: true});
          renderFriends();
          dialog.showModal();
        }
      };
      reader.readAsDataURL(file);
    });
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
    if (!document.querySelector('link[data-friends-style]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'friends.css'; link.dataset.friendsStyle = ''; document.head.append(link); }
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
    const headerAvatar = document.querySelector('.topright .avatar');
    if (headerAvatar) {
      headerAvatar.setAttribute('role', 'button');
      headerAvatar.setAttribute('tabindex', '0');
      headerAvatar.title = '設定個人資料';
      headerAvatar.onclick = () => openLogin(true);
      headerAvatar.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLogin(true); } };
    }
    avatar.onclick = event => { event.stopPropagation(); openLogin(true); };
    button.onclick = () => openLogin();
    control.addEventListener('click', event => {
      if (event.target === button || !state.user) return;
      if (confirm('要登出目前的帳號嗎？')) auth.signOut();
    });
    subscribers.add(next => {
      const profile = next.profile || {};
      const label = profile.name || next.user?.displayName || next.user?.email || '訪客模式';
      name.textContent = label;
      if (headerAvatar) {
        headerAvatar.textContent = profile.name ? profile.name.slice(0, 1) : '我';
        headerAvatar.style.backgroundImage = profile.avatar ? `url(${profile.avatar})` : '';
        headerAvatar.classList.toggle('has-photo', !!profile.avatar);
      }
      if (next.user) {
        avatar.textContent = profile.avatar ? '' : label.slice(0, 1).toUpperCase();
        avatar.style.backgroundImage = profile.avatar ? `url(${profile.avatar})` : '';
        avatar.classList.toggle('has-photo', !!profile.avatar);
        status.textContent = next.error || '紀錄已同步到雲端';
        button.textContent = '登出';
        button.onclick = () => auth.signOut();
      } else {
        avatar.textContent = profile.avatar ? '' : '?';
        avatar.style.backgroundImage = profile.avatar ? `url(${profile.avatar})` : '';
        avatar.classList.toggle('has-photo', !!profile.avatar);
        status.textContent = next.configured ? '登入後跨裝置保存紀錄' : '紀錄只存在此裝置';
        button.textContent = '登入／註冊';
        button.onclick = () => openLogin();
      }
    });
    if (!configured) button.title = '請先完成 Firebase 設定';
    installFriendsUI();

    function installFriendsUI() {
      const nav = document.querySelector('.sidenav');
      if (!nav || nav.querySelector('.friends-nav')) return;
      const friendsButton = document.createElement('a');
      friendsButton.className = 'friends-nav';
      friendsButton.href = '#friends';
      friendsButton.innerHTML = '<span class="friends-nav-icon">+</span><span>好友</span>';
      friendsButton.onclick = event => { event.preventDefault(); openFriends(); };
      nav.append(friendsButton);
    }

    function openFriends() {
      const dialog = document.createElement('dialog');
      dialog.className = 'friends-notice';
      dialog.innerHTML = '<div class="profile-heading"><div><span class="overline">PACE CIRCLE</span><h2>我的好友</h2><p>把一起運動的人，放進你的圈子。</p></div><button class="close" type="button" aria-label="關閉">×</button></div><div class="friends-body"><form class="friends-form"><label>好友暱稱或 Email<input name="friend" maxlength="60" placeholder="例如：小安／name@example.com" required></label><button class="profile-save primary" type="submit">新增好友</button></form><p class="friends-note">輸入好友 Email 後，會顯示好友自己設定的頭像；尚未同步時使用預設人像。</p><div class="friends-list"></div></div>';
      document.body.append(dialog);
      const list = dialog.querySelector('.friends-list');
      const social = document.createElement('div');
      social.innerHTML = '<style>.social-panels{display:grid;gap:10px;margin-top:18px}.social-panel{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid #e0e5da;border-radius:10px;background:#f7f9f3}.social-panel h3{margin:0 0 3px;color:#5d6e59;font-size:12px}.social-panel p{margin:0;color:#8a9581;font-size:10px;line-height:1.6}.social-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#dfe7d3;color:#667655;font-size:16px;flex-shrink:0}.social-panel button{margin-top:8px;border:1px solid #d5ddcc;border-radius:6px;padding:5px 8px;background:#fff;color:#6b7b68;font-size:10px}</style><div class="social-panels"><section class="social-panel"><span class="social-icon">✦</span><div><h3>可能認識的人</h3><p>登入並加入班級後，會依共同課程與共同好友推薦對象。</p><button type="button" disabled>等待好友同步</button></div></section><section class="social-panel"><span class="social-icon">↗</span><div><h3>本週運動排行</h3><p>好友同步後，這裡會顯示本週距離與運動時間排名。</p><button type="button" disabled>尚未開始排行</button></div></section></div>';
      dialog.querySelector('.friends-body').append(social);
      const garden = document.createElement('section');
      garden.className = 'garden-card';
      dialog.querySelector('.friends-body').append(garden);
      const renderGarden = () => {
        const workouts = (state.records || []).filter(record => !record.demo).length;
        const friends = readFriends(state.user?.uid).length;
        const plants = Math.min(12, workouts);
        const animals = Math.min(6, Math.floor(workouts / 3));
        const stage = workouts >= 10 ? '小小生態森林' : workouts >= 5 ? '成長中的小森林' : workouts >= 1 ? '剛發芽的綠地' : '等待第一顆種子';
        const progress = workouts >= 10 ? 100 : (workouts % 5) * 20;
        garden.innerHTML = `<div class="garden-head"><div><span class="overline">PACE ECO CIRCLE</span><h3>一起養一座森林</h3><p>${stage} · 每次真實運動種下一株植物</p></div><strong>${workouts} 次</strong></div><div class="garden-scene" aria-label="運動養成森林"><span class="sun">☼</span><span class="cloud">☁</span><div class="garden-ground"></div>${Array.from({length: plants}, (_, index) => `<span class="plant plant-${index % 4}">🌱</span>`).join('')}${Array.from({length: Math.min(animals, plants)}, (_, index) => `<span class="animal animal-${index % 3}">${['🐿️','🐰','🦋'][index % 3]}</span>`).join('')}</div><div class="garden-progress"><span>距離下一株植物</span><strong>${workouts % 5}/5</strong><i><b style="width:${progress}%"></b></i></div><div class="garden-foot"><span>好友 ${friends} 人</span><span>${friends ? '好友一起加入後可共同照顧' : '新增好友，一起累積生態點'}</span></div>`;
      };
      renderGarden();
      window.PaceAuth?.onChange(next => { if (next.records) { state.records = next.records; renderGarden(); } });
      const form = dialog.querySelector('form');
      const input = form.elements.friend;
      const close = () => { dialog.close(); dialog.remove(); };
      dialog.querySelector('.close').onclick = close;
      const renderFriends = () => {
        const friends = readFriends(state.user?.uid);
        list.replaceChildren();
        if (!friends.length) { list.innerHTML = '<p class="friends-empty">還沒有好友，先新增一位一起運動的夥伴。</p>'; return; }
        friends.forEach((friend, index) => {
          const item = document.createElement('div');
          item.className = 'friend-item';
          const entry = typeof friend === 'string' ? {name: friend, avatar: ''} : friend;
          item.innerHTML = '<span class="friend-avatar"></span><strong></strong><button type="button" aria-label="移除好友">移除</button>';
          const avatar = item.querySelector('.friend-avatar');
          avatar.textContent = entry.avatar ? '' : '👤';
          if (entry.avatar) { avatar.style.backgroundImage = `url(${entry.avatar})`; avatar.classList.add('has-photo'); }
          item.querySelector('strong').textContent = entry.name;
          item.querySelector('button').onclick = () => { const next = readFriends(state.user?.uid); next.splice(index, 1); writeFriends(state.user?.uid, next); renderFriends(); };
          list.append(item);
        });
      };
      form.onsubmit = async event => { event.preventDefault(); const friend = input.value.trim(); if (!friend) return; let entry={name:friend,avatar:''};if(db&&state.user&&friend.includes('@')){const snapshot=await db.collection('publicProfiles').where('email','==',friend.toLowerCase()).limit(1).get();if(!snapshot.empty){const profile=snapshot.docs[0].data();entry={name:profile.name||friend,avatar:profile.avatar||'',uid:snapshot.docs[0].id};}}const friends=readFriends(state.user?.uid);if(!friends.some(item=>(typeof item==='string'?item:item.name)===friend))friends.push(entry);writeFriends(state.user?.uid,friends);input.value='';renderFriends(); };
      dialog.addEventListener('cancel', close, {once: true});
      renderFriends();
      dialog.showModal();
    }

    function openLogin(profileMode = false) {
      if (profileMode) { openProfile(); return; }
      const dialog = document.createElement('dialog');
      dialog.className = 'auth-notice';
      dialog.innerHTML = '<div class="auth-heading"><span class="auth-mark">//</span><div><span class="overline">YOUR PACE ACCOUNT</span><h2>登入你的運動空間</h2></div><button class="close" type="button" aria-label="關閉">×</button></div><p class="auth-lead">保存每一次練習，換一台裝置也能接著看見自己的紀錄。</p><form class="auth-form"><label>Email<input type="email" autocomplete="email" placeholder="name@example.com" required></label><label>密碼<input type="password" minlength="6" autocomplete="current-password" placeholder="至少 6 個字元" required></label><div class="auth-actions"><button class="primary" type="submit">登入帳號 <span>→</span></button><button type="button" class="account-button register">建立新帳號</button></div><p class="auth-privacy"><span>●</span> 密碼由 Firebase 安全處理，運動紀錄只屬於你的帳號。</p></form>';
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
      function openProfile() {
        const profile = state.profile || {};
        const dialog = document.createElement('dialog');
        dialog.className = 'profile-notice';
        dialog.innerHTML = '<div class="profile-heading"><div><span class="overline">PERSONAL PROFILE</span><h2>我的個人主頁</h2><p>讓每一次運動，都有你的名字。</p></div><button class="close" type="button" aria-label="關閉">×</button></div><form class="profile-form"><div class="profile-avatar-row"><div class="profile-preview">我</div><label class="avatar-upload">更換頭貼<input type="file" accept="image/png,image/jpeg,image/webp"></label></div><label>姓名<input name="name" maxlength="30" placeholder="例如：王小明"></label><div class="profile-grid"><label>性別<select name="gender"><option value="">不透露</option><option value="女">女性</option><option value="男">男性</option><option value="其他">其他</option></select></label><label>身高 <span>cm</span><input name="height" type="number" min="80" max="230" placeholder="165"></label><label>年齡 <span>歲</span><input name="age" type="number" min="6" max="100" placeholder="20"></label></div><p class="profile-note">資料只用於你的運動紀錄。未登入時保存在這台裝置；登入後可同步到你的帳號。</p><div class="profile-actions"><button class="profile-save primary" type="submit">儲存個人資料</button></div></form>';
        document.body.append(dialog);
        const form = dialog.querySelector('form');
        const avatarPreview = dialog.querySelector('.profile-preview');
        const avatarInput = dialog.querySelector('input[type="file"]');
        let avatarData = profile.avatar || '';
        const renderPreview = () => { avatarPreview.style.backgroundImage = avatarData ? `url(${avatarData})` : ''; avatarPreview.textContent = avatarData ? '' : (form.elements.name.value.trim().slice(0, 1) || '我'); };
        form.elements.name.value = profile.name || '';
        form.elements.gender.value = profile.gender || '';
        form.elements.height.value = profile.height || '';
        form.elements.age.value = profile.age || '';
        renderPreview();
        avatarInput.onchange = async () => { try { avatarData = await readAvatar(avatarInput.files[0]); renderPreview(); } catch (error) { notice(error.message); } };
        form.elements.name.oninput = renderPreview;
        const close = () => { dialog.close(); dialog.remove(); };
        dialog.querySelector('.close').onclick = close;
        form.onsubmit = async event => {
          event.preventDefault();
          const save = dialog.querySelector('.profile-save');
          save.disabled = true;
          try { await saveProfile({name: form.elements.name.value.trim(), gender: form.elements.gender.value, height: form.elements.height.value ? Number(form.elements.height.value) : '', age: form.elements.age.value ? Number(form.elements.age.value) : '', avatar: avatarData}); close(); }
          catch (error) { notice(error.message || '個人資料儲存失敗，請稍後再試。'); save.disabled = false; }
        };
        dialog.addEventListener('cancel', close, {once: true});
        dialog.showModal();
      }
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
      emit({ready: true, records: readLocal(), profile: readProfile()});
      return;
    }
    try {
      firebase.initializeApp(config);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged(async user => {
        emit({ready: false, user, error: ''});
        const [records, profile] = await Promise.all([loadForUser(user), loadProfile(user)]);
        emit({ready: true, user, records, profile});
      });
    } catch (error) {
      emit({ready: true, records: readLocal(), profile: readProfile(), error: `Firebase 初始化失敗：${error.message || ''}`});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
