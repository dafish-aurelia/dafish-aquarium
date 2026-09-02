// 新标签页跳板（MV3 禁内联脚本，逻辑必须住外部文件）：
// v0.8 语义反转：默认留在珊瑚礁页（这里就是家），仅在用户显式配置
// storage.home_url 时才跳外部水缸。失败（file 不存在/未授权）显示指引。
(async function bootTankRedirect() {
  let tank = null;
  try {
    const { home_url } = await chrome.storage.local.get('home_url');
    if (home_url) tank = home_url;
  } catch (e) { /* storage 不可达：留在珊瑚礁页 */ }
  if (!tank) return; // 未配置外部水缸：珊瑚礁页就是家，什么都不做
  try {
    const tab = await new Promise((res) => chrome.tabs.getCurrent(res));
    if (!tab || tab.id == null) return;
    // 先探测再跳：file 不存在时 tabs.update 会落到 Chrome 报错页，不如留在兜底页
    if (await urlReachable(tank)) {
      await chrome.tabs.update(tab.id, { url: tank });
      return;
    }
  } catch (e) {}
  showFallback(tank);
})();

async function urlReachable(url) {
  if (!url.startsWith('file:')) return true; // 非 file 目标交给浏览器自己处理
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch (e) { return false; }
}

function showFallback(tank) {
  const hint = document.getElementById('file-hint');
  if (!hint) return;
  hint.style.display = 'block';
  document.getElementById('go-ext').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });
  const form = document.getElementById('home-reset');
  if (!form) return;
  const input = form.querySelector('input');
  input.value = tank;
  form.querySelector('button').addEventListener('click', async () => {
    const v = input.value.trim();
    if (!v) return;
    await chrome.storage.local.set({ home_url: v });
    window.DafeiyuSanitize.setHomeUrl(v);
    const st = document.getElementById('home-reset-state');
    if (await urlReachable(v)) {
      const tab = await new Promise((res) => chrome.tabs.getCurrent(res));
      if (tab && tab.id != null) { await chrome.tabs.update(tab.id, { url: v }); return; }
    }
    if (st) st.textContent = '已保存，但这个地址现在还打不开——检查路径或先开「允许访问文件网址」。';
  });
}

const GREETING_POOLS = {
  night: [
    '这么晚了还不睡呀…本鱼把咸鱼干放你桌角了。',
    '深夜的珊瑚礁很安静，主人早点休息哦。'
  ],
  morning: [
    '早上好呀主人，白米饭要趁热吃～',
    '新的一天，也要慢慢游。'
  ],
  noon: [
    '午安～吃饱了想睡觉是本能，不怪主人。'
  ],
  afternoon: [
    '下午好，这片海今天也很平静，适合摸鱼。'
  ],
  evening: [
    '晚上好呀～今天也想偷懒呢。',
    '欢迎回到珊瑚礁～'
  ]
};

function pickGreeting() {
  const h = new Date().getHours();
  let key = 'evening';
  if (h >= 23 || h < 5) key = 'night';
  else if (h < 11) key = 'morning';
  else if (h < 14) key = 'noon';
  else if (h < 18) key = 'afternoon';
  const pool = GREETING_POOLS[key];
  return pool[Math.floor(Math.random() * pool.length)];
}

function tick() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = hh + ':' + mm;
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  document.getElementById('date').textContent =
    now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · 星期' + week;
}

function spawnBubble() {
  const layer = document.querySelector('.bubbles');
  if (!layer) return;
  const b = document.createElement('span');
  b.className = 'bubble';
  const size = 8 + Math.random() * 26;
  b.style.width = size + 'px';
  b.style.height = size + 'px';
  b.style.left = Math.random() * 100 + 'vw';
  b.style.animationDuration = (6 + Math.random() * 8) + 's';
  b.addEventListener('animationend', () => b.remove());
  layer.appendChild(b);
}

tick();
setInterval(tick, 1000);
document.getElementById('greet').textContent = pickGreeting();
for (let i = 0; i < 14; i++) setTimeout(spawnBubble, Math.random() * 6000);
setInterval(spawnBubble, 1800);
