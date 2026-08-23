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
  let lastActivity = Date.now();
  let mode = 'walk'; // walk | follow | still
  let followX = null;
  let followY = null;
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

  // 场景感知台词：70% 说应景的话（工作/看剧/摸鱼），30% 用通用池
  function pickQuip() {
    const scene = window.DafeiyuSenses ? window.DafeiyuSenses.scene() : 'chill';
    const sceneQuips = (quips && typeof quips === 'object' && !Array.isArray(quips)) ? quips : null;
    if (sceneQuips) {
      const pool = sceneQuips[scene] || [];
      if (pool.length && Math.random() < 0.7) return pick(pool);
      return pick(sceneQuips.generic) || '咕噜噜……';
    }
    return pick(Array.isArray(quips) ? quips : []);
  }

  // 心情徽章跟随场景刷新（☀️摸鱼 💼工作 🍿看剧 🏠在家）
  const SCENE_BADGE = { chill: '☀️', work: '💼', video: '🍿', home: '🏠', sleepy: '💤' };
  setInterval(() => {
    const s = window.DafeiyuSenses ? window.DafeiyuSenses.scene() : 'chill';
    if (V.W.state === 'SLEEP') V.setBadge('💤');
    else V.setBadge(SCENE_BADGE[s] || '☀️');
  }, 10e3);

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

  document.addEventListener('pointermove', (e) => {
    followX = e.clientX;
    followY = e.clientY;
    // 主人长时间没动静 → 她打瞌睡；一有动静就醒
    if (V.W.state === 'SLEEP') {
      V.W.state = 'IDLE';
      V.showBubble('唔……本鱼醒了。', 3000);
    }
  });

  // ---- 打瞌睡：主人10分钟没动静，她也睡着（呼。。。）----
  setInterval(() => {
    if (!isActive() || chatOpen() || isHome()) return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor > 10 * 60e3 && V.W.state !== 'SLEEP') {
      V.W.state = 'SLEEP';
      V.setSprite('正面.png', false);
      V.showHeart('呼。。。呼。。。', 5000);
    } else if (V.W.state === 'SLEEP' && Math.random() < 0.5) {
      V.showHeart(pick(['呼。。。', '哈。。。呼。。。', '呼。。。呼。。。呼。。。']), 3500);
    }
  }, 30e3);

  // follow 专用平滑循环：独立于散步调度器，随时响应鼠标（80ms 一帧）
  setInterval(() => {
    if (mode !== 'follow') {
      if (V.W.state === 'FOLLOW') V.W.state = 'IDLE'; // 自愈：模式切走后复位残留
      return;
    }
    if (!isActive()) return;
    // 二维跟随：横纵都追，三视图按方向切换
    const tx = Math.max(60, Math.min(innerWidth - 60, followX ?? V.W.x));
    const tby = Math.max(0, Math.min(innerHeight - 170, innerHeight - (followY ?? innerHeight / 2) - 75));
    const curBy = parseInt(V.root.style.bottom, 10) || 0;
    const dx = tx - V.W.x;
    const dby = tby - curBy;
    if (Math.abs(dx) <= 14 && Math.abs(dby) <= 14) {
      if (V.W.state === 'FOLLOW') { V.W.state = 'IDLE'; V.setSprite('正面.png', false); }
      return;
    }
    V.W.state = 'FOLLOW';
    if (Math.abs(dx) >= Math.abs(dby)) {
      V.W.dir = dx > 0 ? 1 : -1;
      V.setSprite('侧面.png', V.W.dir > 0);
      V.W.x = Math.max(60, Math.min(innerWidth - 60, V.W.x + V.W.dir * 3));
    } else {
      const up = dby > 0; // bottom 增大 = 往上游
      V.setSprite(up ? '背面.png' : '正面.png', false);
      V.root.style.bottom = Math.max(0, Math.min(innerHeight - 170, curBy + Math.sign(dby) * 3)) + 'px';
    }
    V.root.style.left = V.W.x + 'px';
  }, 80);

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

  // ---- 内容感知陪伴：新视频/新章节 → 本地模板即时反应 + 事件上报给缸里的本鱼 ----
  let lastSig = '';
  setInterval(() => {
    if (!isActive() || !window.DafeiyuSenses) return;
    let c;
    try { c = window.DafeiyuSenses.content(); } catch (e) { return; }
    if (!c || !c.kind || !c.title) return;
    const sig = c.kind + '|' + c.title;
    const isFirstOfThisPage = lastSig === '';
    if (sig === lastSig) return;
    lastSig = sig;

    // 本地即时反应：模板填真实标题（80%概率，聊天中不打扰）
    if (!chatOpen() && Math.random() < 0.8) {
      const tplPool = (quips && quips[c.kind + '_tpl']) || [];
      if (tplPool.length) {
        const line = pick(tplPool).replace(/\{title\}/g, c.title);
        V.showBubble(line, 5200, c.kind === 'video' ? 'happy' : 'think');
      }
    }
    // 事件上报：同签名去重（浏览器会话级，storage.session），新内容必报
    (async () => {
      try {
        const { seenSigs = [] } = await chrome.storage.session.get({ seenSigs: [] });
        if (seenSigs.includes(sig)) return;
        seenSigs.push(sig);
        await chrome.storage.session.set({ seenSigs: seenSigs.slice(-20) });
        window.DafeiyuMailbox.outbox({
          type: 'browser_event',
          kind: c.kind,
          title: c.title,
          origin: location.origin,
          excerpt: (c.excerpt || '').slice(0, 160),
        });
      } catch (e) { /* 存储异常时静默 */ }
    })();
  }, 10e3);

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
