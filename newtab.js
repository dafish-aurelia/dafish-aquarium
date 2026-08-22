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
