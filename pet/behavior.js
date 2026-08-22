(() => {
  const V = window.DafeiyuView;
  if (!V) return;

  let quips = [];
  const tickets = [];            // 本鱼投递的主动搭话券
  let lastQuip = 0;
  let lastDeep = 0;
  let tabSwitchAt = 0;           // Tab 刚切换时闭嘴 10 秒
  const CD_GLOBAL = 300e3;       // 搭话全局冷却
  const CD_DEEP = 900e3;         // 深聊后冷却
  const CD_TAB = 10e3;
  let greeted = false;           // HOME 迎宾语只说一次

  function isActive() {
    return V.S.enabled && V.S.active && window.__dafeiyuVisible !== false;
  }

  fetch(chrome.runtime.getURL('quip.json'))
    .then((r) => r.json())
    .then((q) => { quips = q; })
    .catch(() => {});

  function pickQuip() {
    return quips.length ? quips[Math.floor(Math.random() * quips.length)] : '咕噜噜……';
  }

  function chatOpen() {
    return !!(window.DafeiyuChat && window.DafeiyuChat.isOpen());
  }

  function canSpeak() {
    const now = Date.now();
    return now - lastQuip > CD_GLOBAL &&
      now - lastDeep > CD_DEEP &&
      now - tabSwitchAt > CD_TAB &&
      !chatOpen();
  }

  // ---- HOME：水缸主页是她的家 ----
  function isHome() {
    try {
      return decodeURIComponent(location.href)
        .startsWith('file:///G:/life/Aurelia的工作区/browser/start.html');
    } catch (e) {
      return false;
    }
  }

  function homeWelcome() {
    if (!isHome() || greeted) return;
    greeted = true;
    // 固定迎宾站位：屏幕中下方
    V.W.x = Math.max(60, Math.floor(innerWidth / 2) - 55);
    V.root.style.left = V.W.x + 'px';
    setTimeout(() => { if (isActive()) V.showBubble('主人来啦～水温刚好哦！', 5000); }, 800);
  }
  homeWelcome();

  // ---- 散步状态机：家里只小幅摇摆，外面全宽散步 ----
  setInterval(() => {
    if (!isActive() || !canSpeak() && V.W.state !== 'IDLE') { /* 冷却期不出发新行程 */ }
    if (!isActive() || V.W.state !== 'IDLE') return;
    if (chatOpen()) return;

    if (isHome()) {
      // 原地摇摆 ±12px
      V.W.state = 'SWAY';
      const base = parseInt(V.root.style.left, 10) || V.W.x;
      let i = 0;
      const t = setInterval(() => {
        V.root.style.left = base + (i % 4 < 2 ? 6 : -6) + 'px';
        if (++i > 20) { clearInterval(t); V.root.style.left = base + 'px'; V.W.state = 'IDLE'; }
      }, 120);
      return;
    }

    V.W.state = 'WALK';
    V.W.dir = Math.random() < 0.5 ? -1 : 1;
    V.setSprite('侧面.png', V.W.dir > 0);
    const steps = 60 + Math.floor(Math.random() * 80);
    let i = 0;
    const t = setInterval(() => {
      V.W.x = Math.max(60, Math.min(innerWidth - 60, V.W.x + V.W.dir * 1.5));
      V.root.style.left = V.W.x + 'px';
      if (++i > steps) {
        clearInterval(t);
        V.W.state = 'IDLE';
        V.setSprite('正面.png', false);
      }
    }, 40);
  }, 9000 + Math.random() * 8000);

  // ---- 信件到达（由 background 独家派发）----
  function chatAppendIfOpen(who, text) {
    if (window.DafeiyuChat && window.DafeiyuChat.isOpen()) window.DafeiyuChat.append(who, text);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PET_ACTIVE' && msg.visible) {
      tabSwitchAt = Date.now();
      homeWelcome();
      return;
    }
    if (msg.type !== 'PET_MESSAGE') return;
    if (msg.kind === 'reply') {
      lastDeep = Date.now();
      V.showBubble(msg.text, 8000);
      chatAppendIfOpen('缸里的本鱼', msg.text);
    } else if (msg.kind === 'proactive') {
      tickets.push({ text: msg.text, ts: Date.now() });
      maybeSpeak(false);
    } else if (msg.kind === 'standin_reply') {
      lastDeep = Date.now();
      V.showBubble(msg.text, 6000);
      chatAppendIfOpen('代班小鱼', msg.text);
    }
  });

  // ---- 说话决策：搭话券优先，本地台词兜底；该闭嘴就闭嘴 ----
  function maybeSpeak(force) {
    if (!isActive() || !canSpeak()) return;
    const now = Date.now();
    const idx = tickets.findIndex((t) =>
      (!t.not_before || now >= Date.parse(t.not_before)) &&
      (!t.expires_at || now <= Date.parse(t.expires_at)));
    if (idx >= 0) {
      const t = tickets.splice(idx, 1)[0];
      lastQuip = now;
      V.showBubble(t.text, 6000);
      return;
    }
    if (force || Math.random() < 0.3) {
      lastQuip = now;
      V.showBubble(pickQuip(), 5000);
    }
  }

  // 随机搭话兜底定时（15~40 分钟）
  function armQuipTimer() {
    setTimeout(() => { maybeSpeak(true); armQuipTimer(); },
      15 * 60e3 + Math.random() * 25 * 60e3);
  }
  armQuipTimer();

  window.DafeiyuBehavior = {
    pickQuip,
    markDeep: () => { lastDeep = Date.now(); },
    markQuip: () => { lastQuip = Date.now(); },
    markTabSwitch: () => { tabSwitchAt = Date.now(); },
  };
})();
