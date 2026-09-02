(() => {
  const V = window.DafeiyuView;
  const B = window.DafeiyuBehavior;
  if (!V || !B) return;

  // Extension context invalidation guard (after reload, old scripts die)
  let ctxValid = true;
  try { chrome.runtime.getManifest(); } catch (e) { ctxValid = false; }
  if (!ctxValid) {
    console.warn('[dafeiyu] Extension reloaded — please refresh this page.');
    return;
  }

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
        // 0.5.11：真害羞相（捂脸泛红），状态机随后接管
        V.setSprite('shy.png', false);
        setTimeout(() => { if (V.W.state === 'IDLE') V.setSprite('front.png', false); }, 4500);
        try { window.DafeiyuMailbox.outbox({ type: 'pet_event', kind: 'headpat' }); } catch (e) {}
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

  // 单击 = 蹦跳吐槽；双击 = 投喂台。
  // 审查#3：浏览器里双击会先连发两次 click 再触发 dblclick，
  // 用 260ms 判定窗仲裁——双击到达时取消挂起的单击动作，不再白白蹦跳说话。
  let clickTimer = null;
  V.img.addEventListener('click', () => {
    if (moved || touched) { touched = false; return; }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      V.setSprite('front.png', false);
      V.hop();
      V.showBubble(B.pickQuip(), 3500);
    }, 260);
  });
  V.img.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    window.DafeiyuChat.close(); // 面板互斥
    refreshIntimacy();
    feedPanel.style.display = feedPanel.style.display === 'flex' ? 'none' : 'flex';
  });

  // ---- 好感度 ----
  let intimacy = 0;
  chrome.storage.local.get('intimacy').then(({ intimacy: v = 0 }) => { intimacy = Number(v) || 0; });
  async function addIntimacy(n) {
    // 审查四轮P2-2：多 Tab 各持副本会互相覆盖（丢失更新）——写前重读权威值
    try {
      const { intimacy: v = 0 } = await chrome.storage.local.get('intimacy');
      intimacy = Math.round(((Number(v) || 0) + n) * 10) / 10;
    } catch (e) {
      intimacy = Math.round((intimacy + n) * 10) / 10;
    }
    chrome.storage.local.set({ intimacy });
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
    '<p class="dy-hint">喂食会涨好感度哦。双击本体随时打开。</p>';
  document.documentElement.appendChild(feedPanel);
  V.guardEl && V.guardEl(feedPanel); // DOM 自愈守护（B 站等站点会重建子树）
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
      // 0.5.11：真吃相——捧着啃 2.5s，散步/入睡等状态机会自己接管回去
      V.setSprite('eat.png', false);
      setTimeout(() => { if (V.W.state === 'IDLE') V.setSprite('front.png', false); }, 2500);
      window.DafeiyuChat.append('她', `[吃掉了${name}] ${line}`);
      // 让缸里的本鱼也知道投喂发生（30s 节流防刷屏）
      try {
        const now = Date.now();
        if (!window.__dyLastFeedEv || now - window.__dyLastFeedEv > 30e3) {
          window.__dyLastFeedEv = now;
          window.DafeiyuMailbox.outbox({ type: 'pet_event', kind: 'feed', item: name });
        }
      } catch (e) { /* 信局不在家就算了 */ }
    });
    foodsBox.appendChild(btn);
  }

  // ---- 工具条：💬聊天 / 🍪喂食 / ⚙️设置 ----
  // 审查主人反馈：⚙️ 从"循环切大小"升级为设置面板（尺寸/上下文阈值/代班API），
  // 因为循环切换既难发现也放不下钥匙入口。
  const SIZES = [0.8, 1, 1.3];
  let sizeIdx = 1;
  chrome.storage.local.get('pet_scale').then(({ pet_scale: s = 1 }) => {
    sizeIdx = Math.max(0, SIZES.indexOf(Number(s)));
    if (sizeIdx < 0) sizeIdx = 1;
  });

  // 设置面板（⚙️ 打开）
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'dafeiyu-chat dafeiyu-settings';
  settingsPanel.innerHTML =
    '<div class="dy-head"><span>⚙️ 本鱼设置</span><button class="dy-close" title="收起">✕</button></div>' +
    '<label class="dy-row">尺寸：' +
      '<select class="dy-size"><option value="0.8">小</option><option value="1">标准</option><option value="1.3">大</option></select></label>' +
    '<label class="dy-row">上下文保留：<input type="number" class="dy-ctxkeep" min="4" max="40" step="2" style="width:64px"> 条</label>' +
    '<div class="dy-sep"></div>' +
    '<div class="dy-sub">🧠 本体模型（Harness 会话）</div>' +
    '<label class="dy-row">模型：<select class="dy-model"><option value="">加载中…</option></select></label>' +
    '<button class="dy-refresh-model" style="font-size:11px;padding:4px 8px;margin-top:2px">🔄 刷新列表</button> ' +
    '<button class="dy-apply-model" style="font-size:11px;padding:4px 8px;margin-top:2px">✅ 应用到班次</button>' +
    '<span class="dy-model-state" style="font-size:11px;color:#56789a;margin-left:6px"></span>' +
    '<div class="dy-sep"></div>' +
    '<div class="dy-sub">🐠 代班小鱼（本鱼离线时顶班）</div>' +
    // 审查五轮（对抗测试）：钥匙表单不得住在宿主页可读的 DOM 里，
    // 改为跳转扩展自有安全页 settings.html（chrome-extension:// 独立源）。
    '<p class="dy-hint">钥匙在独立安全页配置 —— 那里是扩展自己的地盘，网页脚本读不到。</p>' +
    '<button class="dy-open-key">🔑 打开代班设置页</button>';
  settingsPanel.style.display = 'none';
  document.documentElement.appendChild(settingsPanel);
  V.guardEl && V.guardEl(settingsPanel);

  async function openSettings() {
    window.DafeiyuChat.close();
    feedPanel.style.display = 'none';
    try {
      const { pet_scale: s = 1 } = await chrome.storage.local.get('pet_scale');
      settingsPanel.querySelector('.dy-size').value = String(Number(s) || 1);
      const { ctx_keep: k = 12 } = await chrome.storage.local.get('ctx_keep');
      settingsPanel.querySelector('.dy-ctxkeep').value = Number(k) || 12;
    } catch (e) { /* storage unavailable; use defaults */ }
    settingsPanel.style.display = 'flex';
    loadModels();
  }

  V.root.querySelector('.dafeiyu-toolbar').addEventListener('click', async (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    e.stopPropagation();
    if (act === 'chat') {
      feedPanel.style.display = 'none'; // 面板互斥
      settingsPanel.style.display = 'none';
      window.DafeiyuChat.open();
    }
    if (act === 'feed') {
      const showing = feedPanel.style.display === 'flex';
      window.DafeiyuChat.close(); // 面板互斥
      settingsPanel.style.display = 'none';
      refreshIntimacy();
      feedPanel.style.display = showing ? 'none' : 'flex';
    }
    if (act === 'gear') {
      const showing = settingsPanel.style.display === 'flex';
      window.DafeiyuChat.close();
      feedPanel.style.display = 'none';
      if (showing) settingsPanel.style.display = 'none';
      else await openSettings();
    }
  });

  settingsPanel.querySelector('.dy-size').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ pet_scale: Number(e.target.value) || 1 }); // onChanged 驱动 setScale
  });
  settingsPanel.querySelector('.dy-close').addEventListener('click', () => { settingsPanel.style.display = 'none'; });
  settingsPanel.querySelector('.dy-open-key').addEventListener('click', () => {
    window.DafeiyuMailbox.openStandinSettings();
  });

  // ---- 模型选择：查 Harness 可用模型 + 切换班次模型 ----
  const modelSel = settingsPanel.querySelector('.dy-model');
  const modelState = settingsPanel.querySelector('.dy-model-state');

  // 网络类异常翻译成人话（信局没启动时 raw TypeError 很吓人）
  function friendlyErr(e) {
    const m = String((e && e.message) || e);
    if (/Failed to fetch/i.test(m)) return '信局不在家（重启电脑后需运行 scripts/start_dafeiyu.py）';
    return m;
  }

  async function loadModels() {
    modelState.textContent = '';
    modelSel.innerHTML = '<option value="">加载中…</option>';
    try {
      const res = await window.DafeiyuMailbox.harnessModels();
      if (!res || !res.ok) throw new Error(res?.error || '获取失败');
      modelSel.innerHTML = '';
      for (const g of res.groups) {
        const og = document.createElement('optgroup');
        og.label = g.name;
        for (const m of g.models) {
          const opt = document.createElement('option');
          opt.value = JSON.stringify({ provider: g.id, model: m.id });
          opt.textContent = `${m.name}（${g.name}）`;
          og.appendChild(opt);
        }
        modelSel.appendChild(og);
      }
      // Mark current
      if (res.current) {
        const cur = JSON.stringify(res.current);
        for (const opt of modelSel.options) {
          if (opt.value === cur) { opt.selected = true; break; }
        }
        modelState.textContent = '当前: ' + res.current.model;
      }
    } catch (e) {
      modelSel.innerHTML = '<option value="">不可用</option>';
      modelState.textContent = '⚠ ' + friendlyErr(e);
    }
  }

  settingsPanel.querySelector('.dy-refresh-model').addEventListener('click', loadModels);

  settingsPanel.querySelector('.dy-apply-model').addEventListener('click', async () => {
    if (!modelSel.value) { modelState.textContent = '⚠ 请先选模型'; return; }
    const sel = JSON.parse(modelSel.value);
    modelState.textContent = '切换中…';
    try {
      const res = await window.DafeiyuMailbox.harnessSelectModel(sel);
      if (res && res.ok) {
        modelState.textContent = '✓ 已切到 ' + sel.model;
        V.showBubble('唔…换了新脑子…感觉更聪明了？', 3500);
      } else {
        modelState.textContent = '⚠ 切换失败';
      }
    } catch (e) {
      modelState.textContent = '⚠ ' + friendlyErr(e);
    }
  });



  // ---- 右键模式菜单（散步/跟随/待着）----
  const modeMenu = document.createElement('div');
  modeMenu.className = 'dafeiyu-menu';
  modeMenu.innerHTML =
    '<button data-m="walk">🚶 自由散步</button>' +
    '<button data-m="follow">🖱️ 跟随鼠标</button>' +
    '<button data-m="still">🧘 原地待着</button>' +
    '<button data-m="dodge">🫥 让个位（8秒）</button>' +
    '<button data-m="home">🏠 回水缸</button>' +
    '<button data-m="bottle-save">🫧 丢进漂流瓶</button>' +
    '<button data-m="bottle-view">📖 漂流瓶</button>';
  modeMenu.style.display = 'none';
  document.documentElement.appendChild(modeMenu);
  V.guardEl && V.guardEl(modeMenu);
  V.img.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    modeMenu.style.display = 'block';
    modeMenu.style.left = Math.min(innerWidth - 140, e.clientX) + 'px';
    modeMenu.style.top = Math.min(innerHeight - 130, e.clientY) + 'px';
  });
  modeMenu.addEventListener('click', (e) => {
    const m = e.target?.dataset?.m;
    if (m === 'bottle-save') {
      modeMenu.style.display = 'none';
      saveBottle();
      return;
    }
    if (m === 'bottle-view') {
      modeMenu.style.display = 'none';
      openBottlePanel();
      return;
    }
    if (m === 'home') {
      const url = window.DafeiyuSanitize && window.DafeiyuSanitize.HOME_URL;
      // v0.8：默认空 = 未配置外部水缸；去珊瑚礁页（newtab）而非静默失灵
      if (url) { try { window.DafeiyuMailbox.send({ type: 'OPEN_HOME', url }); } catch (e) {} }
      else { try { window.DafeiyuMailbox.send({ type: 'OPEN_HOME', url: chrome.runtime.getURL('newtab.html') }); } catch (e) {} }
      modeMenu.style.display = 'none';
      return;
    }
    if (m === 'dodge') {
      // 暂时隐身让出点击区域，期间完全穿透；结束后按状态回归
      V.root.style.display = 'none';
      window.__dafeiyuVisible = false;
      setTimeout(() => { V.renderVisible(); }, 8000);
    } else if (m) {
      B.setMode(m);
      V.showBubble(`切换到「${{ walk: '自由散步', follow: '跟随鼠标', still: '原地待着' }[m]}」`, 3000);
    }
    modeMenu.style.display = 'none';
  });
  // ---- 漂流瓶（v0.7）：右键收藏当前页，水缸里捞回 ----
  const bottlePanel = document.createElement('div');
  bottlePanel.className = 'dafeiyu-chat';
  bottlePanel.innerHTML =
    '<div class="dy-head"><span>🫧 漂流瓶</span><button class="dy-close" title="收起">✕</button></div>' +
    '<div class="dafeiyu-chat-log dy-bottle-list"></div>' +
    '<p class="dy-hint">点一条开新标签页；✕ 放走它。本鱼也会看到你收藏了什么。</p>';
  bottlePanel.style.display = 'none';
  document.documentElement.appendChild(bottlePanel);
  V.guardEl && V.guardEl(bottlePanel);

  async function saveBottle() {
    try {
      const sUrl = window.DafeiyuSanitize.sanitizeUrl(location.href);
      const { bottles = [] } = await chrome.storage.local.get('bottles');
      const bottle = { t: Date.now(), title: (document.title || '无题').slice(0, 60), d: sUrl.domain, url: sUrl.url };
      bottles.push(bottle);
      await chrome.storage.local.set({ bottles: bottles.slice(-50) });
      V.hop(); V.floatHearts(3);
      V.showBubble(`🫧 装进漂流瓶啦（第 ${bottles.length} 个）`, 3500);
      try { window.DafeiyuMailbox.outbox({ type: 'pet_event', kind: 'bottle', title: bottle.title, url: bottle.url }); } catch (e) {}
    } catch (e) { V.showBubble('（漂流瓶没扔出去……）', 3000); }
  }

  async function openBottlePanel() {
    window.DafeiyuChat.close(); feedPanel.style.display = 'none'; settingsPanel.style.display = 'none';
    const list = bottlePanel.querySelector('.dy-bottle-list');
    const { bottles = [] } = await chrome.storage.local.get('bottles');
    list.innerHTML = '';
    if (!bottles.length) list.innerHTML = '<div class="dy-msg">空空如也。看到好东西就右键我丢进来～</div>';
    for (let idx = bottles.length - 1; idx >= 0; idx--) {
      const bt = bottles[idx];
      const row = document.createElement('div');
      row.className = 'dy-msg';
      row.innerHTML = '';
      const a = document.createElement('span');
      a.textContent = `🫧 ${bt.title}（${bt.d}）`;
      a.style.cursor = 'pointer';
      a.title = bt.url;
      a.addEventListener('click', () => { try { window.DafeiyuMailbox.send({ type: 'OPEN_URL', url: bt.url }); } catch (e) {} });
      const del = document.createElement('span');
      del.textContent = '✕'; del.style.cssText = 'float:right;cursor:pointer;color:#7ba3c4';
      del.title = '放走它';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const { bottles: bs = [] } = await chrome.storage.local.get('bottles');
        bs.splice(bs.indexOf(bt), 1);
        await chrome.storage.local.set({ bottles: bs });
        openBottlePanel();
      });
      row.appendChild(a); row.appendChild(del);
      list.appendChild(row);
    }
    bottlePanel.style.display = 'flex';
    bottlePanel.querySelector('.dy-close').addEventListener('click', () => { bottlePanel.style.display = 'none'; });
  }

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
  V.guardEl && V.guardEl(panel); // DOM 自愈守护
  panel.style.display = 'none'; // 显式初始隐藏：面板平时由 CSS 隐藏，内联值为空会让旧版 isOpen() 恒真
  const log = panel.querySelector('.dafeiyu-chat-log');
  const conversationContext = [];
  // 跨 Tab 续航（0.5.8）：上下文镜像到本地存储，换页/换 Tab 聊天不再失忆。
  // 多 Tab 同时聊时后写覆盖先写，个人使用可接受；存储随 ctx_keep 裁剪。
  let _ctxSaveT = null;
  function persistCtx() {
    clearTimeout(_ctxSaveT);
    _ctxSaveT = setTimeout(() => {
      try { chrome.storage.local.set({ chat_ctx: conversationContext.slice(-ctxKeep) }); } catch (e) {}
    }, 400);
  }
  chrome.storage.local.get('chat_ctx').then(({ chat_ctx }) => {
    if (Array.isArray(chat_ctx) && chat_ctx.length && conversationContext.length === 0) {
      conversationContext.push(...chat_ctx);
    }
  }).catch(() => {});
  // 上下文保留条数：设置面板可调（审查主人提案），默认 12，范围 4~40
  let ctxKeep = 12;
  chrome.storage.local.get('ctx_keep').then(({ ctx_keep: k = 12 }) => {
    ctxKeep = Math.max(4, Math.min(40, Number(k) || 12));
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.ctx_keep) {
      ctxKeep = Math.max(4, Math.min(40, Number(ch.ctx_keep.newValue) || 12));
    }
  });
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
      persistCtx();
      // 审查#10 + 主人提案：存储裁剪阈值由设置面板 ctx_keep 驱动
      if (conversationContext.length > ctxKeep + 6) {
        conversationContext.splice(0, conversationContext.length - ctxKeep);
      }
    },
  };

  let sending = false; // 审查二轮#2：LLM 等待期防连点重入（并发塞信/重复烧钥匙）
  async function send() {
    if (sending) return;
    const input = panel.querySelector('.dy-input');
    const text = input.value.trim();
    if (!text) return;
    sending = true;
    const btn = panel.querySelector('.dy-send');
    btn.disabled = true;
    input.readOnly = true;
    input.value = '';
    try {
      window.DafeiyuChat.append('主人', text); // append 内部已 push 进 conversationContext，勿重复

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
      } else if (res && res.mode === 'pending_fish') {
        // 本鱼离线且无处代班：信排队等本体，门铃会去叫她回来亲笔回
        B.markDeep();
        const note = (res.text || '信已投出，等本鱼回信～');
        window.DafeiyuChat.append('她', note);
        V.showBubble(note, 6000);
      } else if (res && res.mode === 'offline_no_key') {
        window.DafeiyuChat.append('她', res.text);
        V.showBubble(res.text, 8000);
      } else if (res && res.mode === 'standin_error') {
        window.DafeiyuChat.append('她', res.text);
        V.showBubble(res.text, 6000);
      } else {
        // 审查二轮#4：区分断链/锁门/在途，别让 SW 打盹背"出游"的锅
        const why = res && res.reason === 'auth'
          ? '（信局锁门了，钥匙没对上……）'
          : res && res.reason === 'offline'
            ? '（游不到信局——它出门了吗？信不会丢，稍后自动补送。）'
            : '（信已投出，回信会自己游回来～）';
        window.DafeiyuChat.append('她', why);
        V.showBubble(why, 5000);
      }
    } finally {
      sending = false;
      btn.disabled = false;
      input.readOnly = false;
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
      settingsPanel.style.display = 'none';
      bottlePanel.style.display = 'none';
      modeMenu.style.display = 'none';
    }
  });
  document.addEventListener('mousedown', (e) => {
    const inside = (el) => el.contains(e.target);
    if (panel.style.display !== 'none' && !inside(panel) && !inside(V.root)) panel.style.display = 'none';
    if (feedPanel.style.display !== 'none' && !inside(feedPanel) && !inside(V.root)) feedPanel.style.display = 'none';
    if (settingsPanel.style.display !== 'none' && !inside(settingsPanel) && !inside(V.root)) settingsPanel.style.display = 'none';
  }, true);

  setInterval(() => { if (!window.__dafeiyuRetired) refreshIntimacy(); }, 5000);
})();
