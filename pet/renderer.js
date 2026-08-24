(() => {

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'DEV_REFRESH_PAGE') {
      location.reload();
    }
  });  if (window.__dafeiyu) return;
  window.__dafeiyu = true;
  let _spriteScale = 1;
  const SPR = (n) => chrome.runtime.getURL('sprites/' + n);

  const root = document.createElement('div');
  root.id = 'dafeiyu-root';
  // 构建标记运行时读 manifest（审查二轮#1：手写字符串必然漂移，验收链靠它）
  root.dataset.dyBuild = 'cs-' + chrome.runtime.getManifest().version;
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
  img.src = SPR('front.png');
  // 审查四轮P2-3：水平翻面放独立包装层——img 自身留给动画/CSS 情绪 transform，
  // 否则 WAAPI 的 composite:replace 会吞掉内联镜像（朝左瞬间变朝右）、
  // 类选择器也压不过内联样式导致情绪倾斜在朝左时失效。
  const flipWrap = document.createElement('span');
  flipWrap.className = 'dafeiyu-flip';
  flipWrap.appendChild(img);
  root.append(badge, toolbar, bubble, heart, flipWrap);
  document.documentElement.appendChild(root);

  const W = { x: Math.max(60, innerWidth - 140), dir: -1, state: 'IDLE', online: false };
  root.style.left = W.x + 'px';

  // 三状态分离：可见性 = enabled && active
  const S = { enabled: true, active: false };
  function renderVisible() {
    const v = S.enabled && S.active;
    root.style.display = v ? 'block' : 'none';
    window.__dafeiyuVisible = v;
  }


  const DafeiyuView = {
    W, root, bubble, heart, img, S, flip: flipWrap,
    setSprite(name, flip) {
      img.src = SPR(name);
      flipWrap.style.transform = flip ? 'scaleX(-1)' : '';
      // Normalize display height across all sprite frames
      // All sprites should render at approximately the same visual height
      img.style.height = Math.round(160 * (_spriteScale || 1)) + 'px';
      img.style.width = 'auto';
    },
    // 原生朝向表：+1 图面朝右，-1 朝左，0 无方向（正/背面永不翻转）。
    // 走A/走B 原生朝右而侧面原画朝左，混用统一 flip 规则曾让她倒着走（月球漫步）。
    setSpriteDir(name, dir) {
      const native = { 'front.png': 0, 'back.png': 0, 'side.png': -1, 'walk-a.png': 1, 'walk-b.png': 1 }[name] ?? 0;
      this.setSprite(name, native !== 0 && dir !== 0 && dir !== native);
    },
    showBubble(text, ms = 4000, emo) {
      if (emo) DafeiyuView.setEmotion(emo, ms);
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
      _spriteScale = s;
      img.style.height = Math.round(160 * s) + 'px';
      img.style.width = 'auto';
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

  // 行走帧异步探测：候选序列里实际存在的才入列（顺序即步态顺序），
  // 未就绪前为空数组，行为层据此跳过该轮散步。以后加新帧零代码：
  // 生成 walk-c.png 等丢进 sprites/ 并出现在候选表即可。
  DafeiyuView.walkFrames = [];
  {
    const CANDIDATES = ['walk-a.png', 'walk-c.png', 'walk-d.png', 'walk-b.png'];
    const loaded = [];
    let done = false;
    const finalize = () => {
      if (done) return;
      done = true;
      DafeiyuView.walkFrames = CANDIDATES.filter((n) => loaded.indexOf(n) >= 0);
    };
    CANDIDATES.forEach((n) => {
      const img = new Image();
      img.onload = () => { loaded.push(n); };
      img.src = SPR(n);
    });
    setTimeout(finalize, 2000); // 扩展自有资源毫秒级加载，2s 足够
  }

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

  // ---- 宿主页 DOM 重建自愈（实测 B 站视频页加载后期会重建子树，把注入节点冲掉）----
  // 每 3s 巡查自有元素是否仍挂在 DOM 上，被冲掉就原位重新挂载。
  // 其他脚本通过 DafeiyuView.guardEl(el) 把面板/菜单也纳入守护。
  const guarded = [root];
  DafeiyuView.guardEl = (el) => { if (el && !guarded.includes(el)) guarded.push(el); };
  setInterval(() => {
    let repaired = false;
    for (const el of guarded) {
      if (!el.isConnected) {
        try { document.documentElement.appendChild(el); repaired = true; } catch (e) { /* 页面卸载中 */ }
      }
    }
    if (repaired) { renderVisible(); V.refreshBadge && V.refreshBadge(); }
  }, 3000);

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