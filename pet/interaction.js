(() => {
  const V = window.DafeiyuView;
  const B = window.DafeiyuBehavior;
  if (!V || !B) return;

  // ---- 拖拽：Pointer Events + setPointerCapture（不与页面选字打架）----
  let dragging = false, moved = false, downX = 0, downY = 0;
  V.img.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false; downX = e.clientX; downY = e.clientY;
    V.img.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  V.img.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
    if (moved) {
      V.W.x = Math.max(60, Math.min(innerWidth - 60, e.clientX));
      V.root.style.left = V.W.x + 'px';
      V.root.style.bottom = Math.max(0, innerHeight - e.clientY - 24) + 'px';
    }
  });
  const endDrag = () => {
    if (dragging && moved) V.showBubble(B.pickQuip(), 3000);
    dragging = false;
  };
  V.img.addEventListener('pointerup', endDrag);
  V.img.addEventListener('pointercancel', () => { dragging = false; });

  // 单击 = 蹦跳 + 吐槽；双击 = 聊天面板
  V.img.addEventListener('click', () => {
    if (moved) return;
    V.setSprite('正面.png', false);
    V.showBubble(B.pickQuip(), 3500);
  });
  V.img.addEventListener('dblclick', () => window.DafeiyuChat.open());

  // ---- 聊天面板 ----
  const panel = document.createElement('div');
  panel.className = 'dafeiyu-chat';
  panel.innerHTML =
    '<div class="dafeiyu-chat-log"></div>' +
    '<label style="display:flex;gap:6px;align-items:center;">' +
    '<input type="checkbox" class="dy-deep"> 找缸里的本鱼（深聊）</label>' +
    '<div class="dafeiyu-chat-row">' +
    '<input type="text" class="dy-input" placeholder="跟她说点什么…（@本鱼 也会深聊）">' +
    '<button class="dy-send">说</button></div>';
  document.documentElement.appendChild(panel);
  const log = panel.querySelector('.dafeiyu-chat-log');
  const conversationContext = []; // 只存对话历史；浏览轨迹属 browser_context（V1.5）

  window.DafeiyuChat = {
    isOpen: () => panel.style.display !== 'none',
    open() { panel.style.display = 'flex'; log.scrollTop = log.scrollHeight; },
    append(who, text) {
      const d = document.createElement('div');
      d.textContent = who + '：' + text;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    },
  };

  async function send() {
    const input = panel.querySelector('.dy-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const deep = panel.querySelector('.dy-deep').checked || text.startsWith('@本鱼');
    const clean = text.replace(/^@本鱼/, '').trim();
    window.DafeiyuChat.append('主人', clean);
    conversationContext.push({ who: '主人', text: clean });

    if (!deep) {
      // 快聊：本地台词，秒回
      B.markQuip();
      const r = B.pickQuip();
      conversationContext.push({ who: '她', text: r });
      V.showBubble(r, 4000);
      window.DafeiyuChat.append('她', r);
      return;
    }

    // 深聊：统一交给信局路由（本鱼在线=转信；离线=代班小鱼顶班）
    V.showBubble('（装进信封，游向缸里……）', 3000);
    const env = {
      type: 'deep_chat',
      text: clean,
      page: window.DafeiyuSenses.capture(),
      conversation_context: conversationContext.slice(-6).map((r) => r.who + ':' + r.text),
      browser_context: [],
    };
    const res = await window.DafeiyuMailbox.deepChat(env);
    if (res && res.mode === 'fish') {
      B.markDeep();
      window.DafeiyuChat.append('她', '信送到了，等本鱼回信～');
    } else if (res && res.mode === 'standin') {
      B.markDeep();
      window.DafeiyuChat.append('代班小鱼', res.text);
      V.showBubble(res.text, 6000);
    } else {
      window.DafeiyuChat.append('她', '（本鱼暂时出游了…）');
    }
  }
  panel.querySelector('.dy-send').addEventListener('click', send);
  panel.querySelector('.dy-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
})();
