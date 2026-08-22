(() => {
  const V = window.DafeiyuView;
  if (!V) return;

  let quips = [];
  let hearts = [];
  const tickets = [];
  let lastQuip = 0;
  let lastDeep = 0;
  let tabSwitchAt = 0;
  let lastHeart = Date.now();
  let mode = 'walk'; // walk | follow | still
  let followX = null;
  let greeted = false;
  const CD_GLOBAL = 300e3, CD_DEEP = 900e3, CD_TAB = 10e3;

  function isActive() {
    return !!(V.S && V.S.enabled && V.S.active);
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

  fetch(chrome.runtime.getURL('quip.json')).then((r) => r.json()).then((q) => { quips = q; }).catch(() => {});
  fetch(chrome.runtime.getURL('quip_heart.json')).then((r) => r.json()).then((q) => { hearts = q; }).catch(() => {});

  function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
  function pickQuip() { return pick(quips) || '咕噜噜……'; }

  // ---- HOME：水缸主页是家 ----
  function isHome() {
    try {
      return decodeURIComponent(location.href)
        .startsWith('file:///G:/life/Aurelia的工作区/browser/start.html');
    } catch (e) { return false; }
  }
  function homeWelcome() {
    if (!isHome() || greeted || !isActive()) return;
    greeted = true;
    V.W.x = Math.max(60, Math.floor(innerWidth / 2) - 55);
    V.root.style.left = V.W.x + 'px';
    setTimeout(() => { if (isActive()) V.showBubble('主人来啦～水温刚好哦！', 5000); }, 800);
  }
  homeWelcome();

  // ---- 模式：walk 散步 / follow 跟随鼠标 / still 原地 ----
  function setMode(m) {
    if (!['walk', 'follow', 'still'].includes(m)) return;
    mode = m;
    V.W.state = 'IDLE'; // 切模式时复位残留状态，防止卡死在旧状态（P0 教训）
    chrome.storage.local.set({ pet_mode: m });
  }
  chrome.storage.local.get('pet_mode').then(({ pet_mode }) => { if (pet_mode) { mode = pet_mode; V.W.mode = pet_mode; } });

  document.addEventListener('pointermove', (e) => { if (mode === 'follow') followX = e.clientX; });

  // 鼠标靠近时暂停散步：站好让人家点，别边走边躲
  V.root.addEventListener('mouseenter', () => { V.W.paused = true; });
  V.root.addEventListener('mouseleave', () => { V.W.paused = false; });

  setInterval(() => {
    if (!isActive() || V.W.state !== 'IDLE' || chatOpen() || V.W.paused) return;
    if (isHome()) {
      V.W.state = 'SWAY';
      const base = parseInt(V.root.style.left, 10) || V.W.x;
      let i = 0;
      const t = setInterval(() => {
        V.root.style.left = base + (i % 4 < 2 ? 6 : -6) + 'px';
        if (++i > 20) { clearInterval(t); V.root.style.left = base + 'px'; V.W.state = 'IDLE'; }
      }, 120);
      return;
    }
    if (mode === 'still') return;
    if (mode === 'follow') return; // 跟随由下方专用平滑循环接管
    // walk
    V.W.state = 'WALK';
    V.W.dir = Math.random() < 0.5 ? -1 : 1;
    V.setSprite('侧面.png', V.W.dir > 0);
    const steps = 60 + Math.floor(Math.random() * 80);
    let i = 0;
    const t = setInterval(() => {
      V.W.x = Math.max(60, Math.min(innerWidth - 60, V.W.x + V.W.dir * 1.5));
      V.root.style.left = V.W.x + 'px';
      if (++i > steps) { clearInterval(t); V.W.state = 'IDLE'; V.setSprite('正面.png', false); }
    }, 40);
  }, 4000 + Math.random() * 5000);

  // follow 专用平滑循环：独立于散步调度器，随时响应鼠标（80ms 一帧）
  setInterval(() => {
    if (mode !== 'follow') {
      if (V.W.state === 'FOLLOW') V.W.state = 'IDLE'; // 自愈：模式切走后复位残留
      return;
    }
    if (!isActive()) return;
    if (followX == null || chatOpen()) return;
    const dx = followX - V.W.x;
    if (Math.abs(dx) <= 16) {
      if (V.W.state === 'FOLLOW') { V.W.state = 'IDLE'; V.setSprite('正面.png', false); }
      return;
    }
    V.W.dir = dx > 0 ? 1 : -1;
    V.W.state = 'FOLLOW';
    V.setSprite('侧面.png', V.W.dir > 0);
    V.W.x = Math.max(60, Math.min(innerWidth - 60, V.W.x + V.W.dir * 2.5));
    V.root.style.left = V.W.x + 'px';
  }, 80);

  // ---- 信件派发（background 独家）----
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
    if (force || Math.random() < 0.3) { lastQuip = now; V.showBubble(pickQuip(), 5000); }
  }
  function armQuipTimer() {
    setTimeout(() => { maybeSpeak(true); armQuipTimer(); }, 15 * 60e3 + Math.random() * 25 * 60e3);
  }
  armQuipTimer();

  // ---- 思维链心声：灰色斜体小气泡，独立于搭话冷却，更轻更频 ----
  setInterval(() => {
    if (!hearts.length || !isActive() || chatOpen() || Math.random() > 0.45) return;
    const now = Date.now();
    if (now - lastHeart < 3 * 60e3) return;
    lastHeart = now;
    V.showHeart('（' + pick(hearts) + '）', 5200);
  }, 4 * 60e3);

  // ---- 电量彩蛋（一次性）----
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      if (!b.charging && b.level < 0.2) {
        setTimeout(() => { if (isActive()) V.showBubble('主人的设备饿电了…记得喂它呀⚡', 6000); }, 60e3);
      }
    }).catch(() => {});
  }

  window.DafeiyuBehavior = {
    pickQuip,
    getMode: () => mode,
    setMode,
    markDeep: () => { lastDeep = Date.now(); },
    markQuip: () => { lastQuip = Date.now(); },
  };
})();
