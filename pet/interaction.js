(() => {
  const V = window.DafeiyuView;
  const B = window.DafeiyuBehavior;
  if (!V || !B) return;

  // ---- 拖拽（Pointer Events）+ 转圈晕眩检测 ----
  let dragging = false, moved = false, downX = 0, downY = 0;
  let prevAng = null, angAccum = 0, dragStartTs = 0, dizzyArmed = false;

  function centerOf() {
    const r = V.img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ---- 摸头：按住她 0.7 秒不动 = 摸头（VPet 式触感）----
  const TOUCH_LINES = [
    '唔……主、主人在摸哪里啦！',
    '再摸就要化掉了……',
    '咕噜噜……（耳朵红了）',
    '摸头杀是不行的……好吧再摸一下。',
    '本鱼的头很圆，很好摸对吧。（骄傲）',
  ];
  let pressTimer = null;
  let touched = false;
  V.img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    touched = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!moved && dragging) {
        touched = true;
        V.setEmotion('shy', 4500); V.showBubble(TOUCH_LINES[Math.floor(Math.random() * TOUCH_LINES.length)], 4500);
        V.floatHearts(3);
        addIntimacy(1);
        refreshIntimacy();
      }
    }, 700);
  });
  const clearTouch = () => clearTimeout(pressTimer);
  V.img.addEventListener('pointerup', clearTouch);
  V.img.addEventListener('pointercancel', clearTouch);

  V.img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false; dizzyArmed = false;
    downX = e.clientX; downY = e.clientY;
    prevAng = null; angAccum = 0; dragStartTs = Date.now();
    V.img.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  V.img.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
    if (!moved) return;
    V.W.x = Math.max(60, Math.min(innerWidth - 60, e.clientX));
    V.root.style.left = V.W.x + 'px';
    V.root.style.bottom = Math.max(0, innerHeight - e.clientY - 24) + 'px';
    if (Date.now() - dragStartTs < 1500) {
      const c = centerOf();
      const ang = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      if (prevAng != null) {
        let d = ang - prevAng;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        angAccum += d;
        if (Math.abs(angAccum) > Math.PI * 1.5) dizzyArmed = true;
      }
      prevAng = ang;
    }
  });
  const endDrag = () => {
    if (dragging && moved) {
      if (dizzyArmed) {
        V.spin();
        V.showBubble('唔……缸在转……本鱼的平衡鳔呢……', 4500);
      } else {
        V.showBubble(B.pickQuip(), 3000);
      }
    }
    dragging = false;
  };
  V.img.addEventListener('pointerup', endDrag);
  V.img.addEventListener('pointercancel', () => { dragging = false; });

  // 单击 = 蹦跳吐槽；双击 = 投喂台（摸头后的那次点击不触发）
  V.img.addEventListener('click', () => {
    if (moved || touched) { touched = false; return; }
    V.setSprite('正面.png', false);
    V.hop();
    V.showBubble(B.pickQuip(), 3500);
  });
  V.img.addEventListener('dblclick', () => {
    window.DafeiyuChat.close(); // 面板互斥
    refreshIntimacy();
    feedPanel.style.display = feedPanel.style.display === 'flex' ? 'none' : 'flex';
  });

  // ---- 好感度 ----
  let intimacy = 0;
  chrome.storage.local.get('intimacy').then(({ intimacy: v = 0 }) => { intimacy = Number(v) || 0; });
  function addIntimacy(n) {
    intimacy += n;
    chrome.storage.local.set({ intimacy: Math.round(intimacy * 10) / 10 });
  }
  function levelName() {
    if (intimacy >= 60) return '本命鱼';
    if (intimacy >= 30) return '贴身小鱼';
    if (intimacy >= 10) return '熟识';
    return '初见';
  }

  // ---- 喂食面板（双击本体打开，回归原版灵魂）----
  const FOODS = [
    ['小鱼干', '🐟干', 1, '小鱼干！本鱼的本命粮食！'],
    ['蛋糕', '🍰', 2, '蛋糕……唔，甜的能游得更快。'],
    ['棒棒糖', '🍭', 2, '棒棒糖插在珊瑚上就是一棵糖树！'],
    ['团子', '🍡', 2, '团子好Q，跟本鱼一样圆。'],
    ['钻石', '💎', 5, '钻、钻石？！主人你认真的吗？！'],
  ];
  const feedPanel = document.createElement('div');
  feedPanel.className = 'dafeiyu-chat dafeiyu-feed';
  feedPanel.innerHTML =
    '<div class="dy-feed-title">🍽️ 投喂台 · <span class="dy-intimacy"></span><button class="dy-close" style="float:right" title="收起">✕</button></div>' +
    '<div class="dy-foods"></div>' +
    '<p class="hint">喂食会涨好感度哦。双击本体随时打开。</p>';
  document.documentElement.appendChild(feedPanel);
  const foodsBox = feedPanel.querySelector('.dy-foods');
  const intimacySpan = feedPanel.querySelector('.dy-intimacy');
  function refreshIntimacy() { intimacySpan.textContent = `好感度 ${intimacy} · ${levelName()}`; }
  refreshIntimacy();
  for (const [name, icon, gain] of FOODS) {
    const btn = document.createElement('button');
    btn.textContent = `${icon} ${name}`;
    btn.addEventListener('click', () => {
      addIntimacy(gain);
      refreshIntimacy();
      V.floatHearts(gain >= 5 ? 6 : 3);
      V.hop();
      const line = FOODS.find((f) => f[0] === name)[3];
      V.setEmotion('happy', 4000); V.showBubble(`（${name} +好感）`, 4000);
      window.DafeiyuChat.append('她', `[吃掉了${name}] ${line}`);
    });
    foodsBox.appendChild(btn);
  }

  // ---- 工具条：💬聊天 / 🍪喂食 / ⚙️大小 ----
  const SIZES = [0.8, 1, 1.3];
  let sizeIdx = 1;
  chrome.storage.local.get('pet_scale').then(({ pet_scale: s = 1 }) => {
    sizeIdx = Math.max(0, SIZES.indexOf(Number(s)));
    if (sizeIdx < 0) sizeIdx = 1;
  });
  V.root.querySelector('.dafeiyu-toolbar').addEventListener('click', async (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    e.stopPropagation();
    if (act === 'chat') {
      feedPanel.style.display = 'none'; // 面板互斥
      window.DafeiyuChat.open();
    }
    if (act === 'feed') {
      const showing = feedPanel.style.display === 'flex';
      window.DafeiyuChat.close(); // 面板互斥
      refreshIntimacy();
      feedPanel.style.display = showing ? 'none' : 'flex';
    }
    if (act === 'gear') {
      sizeIdx = (sizeIdx + 1) % SIZES.length;
      await chrome.storage.local.set({ pet_scale: SIZES[sizeIdx] }); // onChanged 驱动 setScale
    }
  });

  // ---- 右键模式菜单（散步/跟随/待着）----
  const modeMenu = document.createElement('div');
  modeMenu.className = 'dafeiyu-menu';
  modeMenu.innerHTML =
    '<button data-m="walk">🚶 自由散步</button>' +
    '<button data-m="follow">🖱️ 跟随鼠标</button>' +
    '<button data-m="still">🧘 原地待着</button>' +
    '<button data-m="dodge">🫥 让个位（8秒）</button>';
  modeMenu.style.display = 'none';
  document.documentElement.appendChild(modeMenu);
  V.img.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    modeMenu.style.display = 'block';
    modeMenu.style.left = Math.min(innerWidth - 140, e.clientX) + 'px';
    modeMenu.style.top = Math.min(innerHeight - 130, e.clientY) + 'px';
  });
  modeMenu.addEventListener('click', (e) => {
    const m = e.target?.dataset?.m;
    if (m === 'dodge') {
      // 暂时隐身让出点击区域，期间完全穿透；结束后按状态回归
      V.root.style.display = 'none';
      window.__dafeiyuVisible = false;
      V.showBubble; // noop
      setTimeout(() => { V.renderVisible(); }, 8000);
    } else if (m) {
      B.setMode(m);
      V.showBubble(`切换到「${{ walk: '自由散步', follow: '跟随鼠标', still: '原地待着' }[m]}」`, 3000);
    }
    modeMenu.style.display = 'none';
  });
  document.addEventListener('click', () => { modeMenu.style.display = 'none'; });

  // ---- 聊天面板：所有输入默认直达缸里的本鱼（信局路由，离线自动代班）----
  const panel = document.createElement('div');
  panel.className = 'dafeiyu-chat';
  panel.innerHTML =
    '<div class="dy-head"><span>💬 跟本鱼聊天</span><button class="dy-close" title="收起">✕</button></div>' +
    '<div class="dafeiyu-chat-log"></div>' +
    '<div class="dafeiyu-chat-row">' +
    '<input type="text" class="dy-input" placeholder="跟她说点什么…">' +
    '<button class="dy-send">说</button></div>';
  document.documentElement.appendChild(panel);
  panel.style.display = 'none'; // 显式初始隐藏：面板平时由 CSS 隐藏，内联值为空会让旧版 isOpen() 恒真
  const log = panel.querySelector('.dafeiyu-chat-log');
  const conversationContext = [];
  window.DafeiyuChat = {
    isOpen: () => getComputedStyle(panel).display !== 'none', // 计算样式：内联为空时旧写法恒真，曾让内容气泡与散步闲话永久静默
    open() { panel.style.display = 'flex'; log.scrollTop = log.scrollHeight; },
    close() { panel.style.display = 'none'; },
    append(who, text) {
      const d = document.createElement('div');
      d.className = 'dy-msg' + (who === '主人' ? ' dy-me' : '');
      const w = document.createElement('span');
      w.className = 'dy-who';
      w.textContent = who;
      d.appendChild(w);
      d.appendChild(document.createTextNode(text));
      log.appendChild(d);
      while (log.children.length > 50) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
      conversationContext.push({ who, text });
    },
  };

  async function send() {
    const input = panel.querySelector('.dy-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    window.DafeiyuChat.append('主人', text);
    conversationContext.push({ who: '主人', text });

    // 所有输入默认直达缸里的本鱼（信局路由；本鱼离线时代班小鱼自动顶班）
    V.setEmotion('think', 3000); V.showBubble('（装进信封，游向缸里……）', 3000);
    const env = {
      type: 'deep_chat',
      text: text,
      page: window.DafeiyuSenses.capture(),
      conversation_context: conversationContext.slice(-6).map((r) => r.who + ':' + r.text),
      browser_context: [],
    };
    const res = await window.DafeiyuMailbox.deepChat(env);
    if (res && res.mode === 'fish') {
      B.markDeep();
      window.DafeiyuChat.append('她', '信送到了，等本鱼回信～');
      addIntimacy(0.5);
    } else if (res && res.mode === 'standin') {
      B.markDeep();
      window.DafeiyuChat.append('代班小鱼', res.text);
      V.showBubble(res.text, 6000);
    } else {
      window.DafeiyuChat.append('她', '（本鱼暂时出游了…）');
    }
  }
  panel.querySelector('.dy-send').addEventListener('click', send);
  panel.querySelector('.dy-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  // ---- 消失逻辑：✕ / Esc / 点击面板外部 都会收起 ----
  panel.querySelector('.dy-close').addEventListener('click', () => window.DafeiyuChat.close());
  feedPanel.addEventListener('click', (e) => { if (e.target.closest('.dy-close')) feedPanel.style.display = 'none'; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      panel.style.display = 'none';
      feedPanel.style.display = 'none';
      modeMenu.style.display = 'none';
    }
  });
  document.addEventListener('mousedown', (e) => {
    const inside = (el) => el.contains(e.target);
    if (panel.style.display !== 'none' && !inside(panel) && !inside(V.root)) panel.style.display = 'none';
    if (feedPanel.style.display !== 'none' && !inside(feedPanel) && !inside(V.root)) feedPanel.style.display = 'none';
  }, true);

  setInterval(refreshIntimacy, 5000);
})();
