(() => {
  if (window.__dafish_loaded) return;
  window.__dafish_loaded = true;

  const LINES = {
    chill: [
      '这片网页的水温刚刚好，适合躺平。',
      '唔——主人有事快讲，本鱼正在晒太阳。',
      '哼，本鱼才不是在摸鱼，本鱼是在巡逻珊瑚礁！',
      '别戳啦，戳本鱼也不会多一口白米饭的咕噜…',
      '你、你别一直盯着本鱼看啦，会害羞的…'
    ],
    work: [
      '主人在认真干活！本鱼…本鱼也有在认真巡逻哦。',
      '代码要好好写，白米饭要好好吃，咕噜。',
      '嗯嗯，这个仓库看起来很棒（其实本鱼没看懂）。',
      '遇到 bug 了吗？本鱼帮你瞪它！'
    ],
    video: [
      '陪主人看剧～音量记得调小声一点哦。',
      '这部电影里有鲸鱼吗？没有的话本鱼亲自出演。',
      '嘘……别告诉别人本鱼在偷看。',
      '看到精彩的地方记得叫本鱼一起看！'
    ],
    sleepy: [
      '唔唔……主人，都几点了，该睡觉了啦…',
      '本鱼把咸鱼干叼来了，吃完就睡，不许熬夜。',
      '再不睡，本鱼就把珊瑚礁的电闸拉了咕噜。',
      '晚安……本鱼先眯一会儿，主人也快睡哦。'
    ]
  };

  const MOOD_BADGE = { chill: '☀️', work: '💼', video: '🍿', sleepy: '💤' };

  function detectMood() {
    const h = new Date().getHours();
    if (h >= 23 || h < 5) return 'sleepy';
    const host = location.hostname;
    if (/(^|\.)github\.com$|(^|\.)stackoverflow\.com$|(^|\.)gitee\.com$|(^|\.)juejin\.cn$|(^|\.)csdn\.net$/.test(host)) return 'work';
    if (/(^|\.)bilibili\.com$|(^|\.)youtube\.com$|(^|\.)iqiyi\.com$|(^|\.)youku\.com$|(^|\.)netflix\.com$/.test(host)) return 'video';
    return 'chill';
  }

  const mood = detectMood();

  const pet = document.createElement('div');
  pet.id = 'dafish-pet';
  const bob = document.createElement('span');
  bob.className = 'dafish-bob';
  const flip = document.createElement('span');
  flip.className = 'dafish-flip';
  flip.textContent = '🐳';
  const badge = document.createElement('span');
  badge.className = 'dafish-badge';
  badge.textContent = MOOD_BADGE[mood];
  bob.appendChild(flip);
  bob.appendChild(badge);
  pet.appendChild(bob);
  document.documentElement.appendChild(pet);

  let x = 0;
  let dir = 1;
  let restTicks = 0;

  setInterval(() => {
    if (restTicks > 0) { restTicks--; return; }
    if (Math.random() < 0.004) { restTicks = 40 + Math.floor(Math.random() * 60); return; }
    const limit = Math.max(0, window.innerWidth - pet.offsetWidth - 8);
    const speed = mood === 'sleepy' ? 0.6 : (mood === 'work' ? 1.6 : 1.1);
    x += dir * speed;
    if (x >= limit) { x = limit; dir = -1; flip.classList.add('dafish-turned'); }
    else if (x <= 0) { x = 0; dir = 1; flip.classList.remove('dafish-turned'); }
    pet.style.transform = 'translateX(' + x + 'px)';
  }, 40);

  function spawnBubble() {
    const b = document.createElement('span');
    b.className = 'dafish-bubble';
    const size = 6 + Math.random() * 8;
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    b.style.left = (x + pet.offsetWidth / 2 + (Math.random() * 16 - 8)) + 'px';
    document.documentElement.appendChild(b);
    b.addEventListener('animationend', () => b.remove());
  }
  setInterval(spawnBubble, mood === 'sleepy' ? 4200 : 2600);

  let speech = null;
  function say(text) {
    if (speech) speech.remove();
    speech = document.createElement('div');
    speech.className = 'dafish-speech';
    speech.textContent = text;
    pet.appendChild(speech);
    setTimeout(() => { if (speech) { speech.remove(); speech = null; } }, 2500);
  }

  const pool = LINES[mood];
  pet.addEventListener('click', () => say(pool[Math.floor(Math.random() * pool.length)]));

  pet.addEventListener('dblclick', () => {
    const glyph = mood === 'sleepy' ? '🐟' : '🍚';
    for (let i = 0; i < 15; i++) {
      const r = document.createElement('span');
      r.className = 'dafish-rice';
      r.textContent = glyph;
      r.style.left = (2 + Math.random() * 96) + 'vw';
      r.style.fontSize = (18 + Math.random() * 14) + 'px';
      r.style.animationDelay = (Math.random() * 0.8) + 's';
      document.documentElement.appendChild(r);
      r.addEventListener('animationend', () => r.remove());
    }
    say(mood === 'sleepy'
      ? '咸鱼干雨！吃完就乖乖睡觉哦…'
      : '哇！白米饭雨！本鱼没有偷吃，只是帮屏幕做个清洁！');
  });
})();
