(() => {
  if (window.__dafeiyu) return;
  window.__dafeiyu = true;
  const SPR = (n) => chrome.runtime.getURL('sprites/' + n);

  const root = document.createElement('div');
  root.id = 'dafeiyu-root';
  const toolbar = document.createElement('div');
  toolbar.className = 'dafeiyu-toolbar';
  toolbar.innerHTML =
    '<button data-act="chat" title="找她聊天">💬</button>' +
    '<button data-act="feed" title="喂食">🍪</button>' +
    '<button data-act="gear" title="大小">⚙️</button>';
  const badge = document.createElement('span');
  badge.className = 'dafeiyu-badge';
  badge.textContent = '☀️';
  badge.title = '她现在的心情';
  const bubble = document.createElement('div');
  bubble.className = 'dafeiyu-bubble';
  bubble.style.display = 'none';
  const heart = document.createElement('div');
  heart.className = 'dafeiyu-bubble dafeiyu-heart';
  heart.style.display = 'none';
  const img = document.createElement('img');
  img.className = 'dafeiyu-sprite';
  img.src = SPR('正面.png');
  root.append(badge, toolbar, bubble, heart, img);
  document.documentElement.appendChild(root);

  const W = { x: Math.max(60, innerWidth - 140), dir: -1, state: 'IDLE', online: false, mode: 'walk' };
  root.style.left = W.x + 'px';

  // 三状态分离：可见性 = enabled && active
  const S = { enabled: true, active: false };
  function renderVisible() {
    const v = S.enabled && S.active;
    root.style.display = v ? 'block' : 'none';
    window.__dafeiyuVisible = v;
  }

  const DafeiyuView = {
    W, root, bubble, heart, img, S,
    setSprite(name, flip) {
      img.src = SPR(name);
      img.style.transform = flip ? 'scaleX(-1)' : '';
    },
    showBubble(text, ms = 4000) {
      bubble.classList.remove('dafeiyu-heart');
      bubble.textContent = text;
      bubble.style.display = 'block';
      clearTimeout(bubble._t);
      bubble._t = setTimeout(() => { bubble.style.display = 'none'; }, ms);
    },
    showHeart(text, ms = 5000) {
      heart.textContent = text;
      heart.style.display = 'block';
      clearTimeout(heart._t);
      heart._t = setTimeout(() => { heart.style.display = 'none'; }, ms);
    },
    setScale(s = 1) {
      img.style.width = Math.round(110 * s) + 'px';
    },
    hop() {
      img.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-14px)' }, { transform: 'translateY(0)' }],
        { duration: 320, easing: 'ease-out' }
      );
    },
    spin() {
      img.animate(
        [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(720deg) scale(0.9)' }, { transform: 'rotate(720deg) scale(1)' }],
        { duration: 900, easing: 'ease-in-out' }
      );
    },
    floatHearts(n = 3) {
      for (let i = 0; i < n; i++) {
        const h = document.createElement('span');
        h.className = 'dafeiyu-float';
        h.textContent = Math.random() < 0.5 ? '💗' : '🫧';
        h.style.left = 20 + Math.random() * 70 + 'px';
        root.appendChild(h);
        setTimeout(() => h.remove(), 1600);
      }
    },
    // ---- 表情系统：程序化情绪预设（无新素材，纯 CSS 滤镜/变换）----
    setBadge(emoji) { badge.textContent = emoji || '☀️'; },
    setEmotion(name, ms = 2600) {
      const ALL = ['dy-emo-shy', 'dy-emo-sleepy', 'dy-emo-think', 'dy-emo-worry', 'dy-emo-happy'];
      ALL.forEach((c) => img.classList.remove(c));
      if (name && ALL.includes('dy-emo-' + name)) {
        img.classList.add('dy-emo-' + name);
        clearTimeout(img._emoT);
        if (ms > 0) img._emoT = setTimeout(() => img.classList.remove('dy-emo-' + name), ms);
      }
    },
    renderVisible,
  };
  window.DafeiyuView = DafeiyuView;

  // 微生命：随机眨眼（轻微压扁一瞬）
  (function blinkLoop() {
    setTimeout(() => {
      if (!document.hidden && window.__dafeiyuVisible) {
        img.animate(
          [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.94)' }, { transform: 'scaleY(1)' }],
          { duration: 130, easing: 'ease-in-out' }
        );
      }
      blinkLoop();
    }, 2800 + Math.random() * 3200);
  })();

  chrome.storage.local.get(['enabled', 'pet_scale']).then(({ enabled = true, pet_scale = 1 }) => {
    S.enabled = enabled;
    DafeiyuView.setScale(Number(pet_scale) || 1);
    renderVisible();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.enabled) { S.enabled = ch.enabled.newValue !== false; renderVisible(); }
    if (ch.pet_scale) DafeiyuView.setScale(Number(ch.pet_scale.newValue) || 1);
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PET_ACTIVE') {
      S.active = !!msg.visible;
      renderVisible();
    }
  });

  // 拉取式兜底（P0 竞态修复）：推送可能在监听注册前到达而丢失，
  // 醒来后主动向 background 查询一次真实状态；SW 冷启动慢时再补一枪。
  function queryState() {
    try {
      const p = chrome.runtime.sendMessage({ type: 'PET_QUERY_STATE' });
      Promise.resolve(p).then((s) => {
        if (!s) return;
        if (typeof s.active === 'boolean') S.active = s.active;
        if (typeof s.enabled === 'boolean') S.enabled = s.enabled;
        renderVisible();
      }).catch(() => {});
    } catch (e) { /* 扩展上下文重载中的瞬态错误，忽略 */ }
  }
  queryState();
  setTimeout(queryState, 900);
})();
