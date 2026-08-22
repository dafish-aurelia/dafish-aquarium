(() => {
  if (window.__dafeiyu) return;
  window.__dafeiyu = true;
  const SPR = (n) => chrome.runtime.getURL('sprites/' + n);

  const root = document.createElement('div');
  root.id = 'dafeiyu-root';
  const bubble = document.createElement('div');
  bubble.className = 'dafeiyu-bubble';
  bubble.style.display = 'none';
  const img = document.createElement('img');
  img.className = 'dafeiyu-sprite';
  img.src = SPR('正面.png');
  root.append(bubble, img);
  document.documentElement.appendChild(root);

  const W = { x: Math.max(60, innerWidth - 140), dir: -1, state: 'IDLE', online: false };
  root.style.left = W.x + 'px';

  // 三状态分离（P0 修复）：可见性 = enabled && active，两个来源各自更新，永不互相覆盖
  const S = { enabled: true, active: false };

  function renderVisible() {
    const v = S.enabled && S.active;
    root.style.display = v ? 'block' : 'none';
    window.__dafeiyuVisible = v;
  }

  const DafeiyuView = {
    W, root, bubble, img, S,
    setSprite(name, flip) {
      img.src = SPR(name);
      img.style.transform = flip ? 'scaleX(-1)' : '';
    },
    showBubble(text, ms = 4000) {
      bubble.textContent = text;
      bubble.style.display = 'block';
      clearTimeout(bubble._t);
      bubble._t = setTimeout(() => { bubble.style.display = 'none'; }, ms);
    },
    renderVisible,
  };
  window.DafeiyuView = DafeiyuView;

  chrome.storage.local.get('enabled').then(({ enabled = true }) => {
    S.enabled = enabled;
    renderVisible();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.enabled) {
      S.enabled = ch.enabled.newValue !== false;
      renderVisible();
    }
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PET_ACTIVE') {
      S.active = !!msg.visible;
      renderVisible();
    }
  });
})();
