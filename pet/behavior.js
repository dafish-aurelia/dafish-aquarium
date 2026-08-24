(() => {
  const V = window.DafeiyuView;
  if (!V) return;

  // 台词内置（审查#7：web_accessible_resources 的 JSON 可被任意站点探测扩展指纹）。
  // sleepy 池保留作数据资产；当前 scene() 不再返回 sleepy（深夜困困模式属旧版行为）。
  const BUNDLED_QUIPS = {
    generic: [
      '唔……主人在看什么呀？',
      '本鱼今天也在缸里游得很圆。',
      '咕噜噜……（吐泡泡）',
      '主人主人，水温刚好哦。',
      '这条网页有点干，本鱼帮你加点水。',
      '唔？主人往这边看一眼嘛。',
      '本鱼没有偷懒，只是在待机。'
    ],
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
      '本鱼把咸鱼干叼来了，吃完就睡，不许熬夜。'
    ],
    video_tpl: [
      '《{title}》！本鱼也一起看～',
      '这部《{title}》看起来很有料的样子。',
      '{title}？看完跟本鱼讲讲嘛。',
      '换台《{title}》了？之前的看完了吗～'
    ],
    novel_tpl: [
      '《{title}》追到哪章啦？别太晚睡哦。',
      '又在看《{title}》呀，好看吗？',
      '看《{title}》记得开灯，不然本鱼会担心。',
      '《{title}》……主角还活着吗？（小声）'
    ]
  };
  const BUNDLED_HEARTS = [
    '水温二十四度，适合摸鱼。',
    '今天的白米饭好香……不对，是这个网页好香。',
    '主人点页面的样子，好像在投喂本鱼。',
    '泡泡……咕噜噜……',
    '这条鱼的工位真大，整个浏览器都是。',
    '唔，那个链接看起来很好吃。',
    '值班日志：一切正常。除了有点想你。',
    '如果本鱼有口袋，会把今天的开心存进去。',
    '深海没有日历，但有主人打开的次数。',
    '刚才那条弹窗吓本鱼一跳……装镇定。',
    '游累了吗主人？本鱼可以陪你发呆。',
    '听说双击会有好事发生……骗你的，是单击。',
    '本鱼的思维链好长啊……算了不想了。',
    '今天也在认真待机中，请放心摸鱼。'
  ];
  const QUIPS = BUNDLED_QUIPS;
  const HEARTS = BUNDLED_HEARTS;
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

  function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }

  // 场景感知台词：70% 说应景的话（工作/看剧/摸鱼），30% 用通用池
  // （审查二轮P2：词料已内置为常量对象，删除数组分支死代码）
  function pickQuip() {
    const scene = window.DafeiyuSenses ? window.DafeiyuSenses.scene() : 'chill';
    const pool = (QUIPS[scene] || []).length && Math.random() < 0.7 ? QUIPS[scene] : QUIPS.generic;
    return pick(pool) || '咕噜噜……';
  }

  // 心情徽章跟随场景刷新（☀️摸鱼 💼工作 🍿看剧 🏠在家）
  const SCENE_BADGE = { chill: '☀️', work: '💼', video: '🍿', novel: '📖', home: '🏠', sleepy: '💤' };
  function refreshBadge() {
    const s = window.DafeiyuSenses ? window.DafeiyuSenses.scene() : 'chill';
    if (V.W.state === 'SLEEP') V.setBadge('💤');
    else V.setBadge(SCENE_BADGE[s] || '☀️');
  }
  refreshBadge(); // 立即刷一次，别让头 10 秒顶着默认 ☀️ 见人
  setInterval(refreshBadge, 10e3);

  // ---- HOME：水缸主页是家 ----
  function isHome() {
    try {
      return decodeURIComponent(location.href)
        .startsWith(window.DafeiyuSanitize.HOME_URL);
    } catch (e) { return false; }
  }
  function homeWelcome() {
    if (!isHome() || greeted || !isActive()) return;
    greeted = true;
    V.W.x = Math.max(60, Math.floor(innerWidth / 2) - 55);
    V.root.style.left = V.W.x + 'px';
    // 0.5.11：招手迎接（wave 帧 4s），随后回正面
    V.setSprite('wave.png', false);
    setTimeout(() => { if (V.W.state === 'IDLE') V.setSprite('front.png', false); }, 4000);
    setTimeout(() => { if (isActive()) V.showBubble('主人来啦～水温刚好哦！', 5000); }, 800);
  }
  homeWelcome();

  function stopMover() {
    // 审查四轮P2-4：散步/摇摆步进句柄统一外挂 V.W._mover，这里负责掐断
    if (V.W._mover) { clearInterval(V.W._mover); V.W._mover = null; }
    V.img.classList.remove('dy-walk-bob');
  }

  // ---- 模式：walk 散步 / follow 跟随鼠标 / still 原地 ----
  function setMode(m) {
    if (!['walk', 'follow', 'still'].includes(m)) return;
    mode = m;
    stopMover(); // 审查四轮P2-4：切模式立刻掐断散步/摇摆步进，不再走完残留全程
    V.W.state = 'IDLE'; // 切模式时复位残留状态，防止卡死在旧状态（P0 教训）
    V.setSprite('front.png', false);
    chrome.storage.local.set({ pet_mode: m });
  }
  chrome.storage.local.get('pet_mode').then(({ pet_mode }) => { if (pet_mode) mode = pet_mode; });

  let lastGreetAt = 0;
let hiddenAt = 0;
const WELCOME_BACK_LINES = ['诶，主人回来啦。', '本鱼刚刚还在想你去哪了。', '欢迎回来～水缸水温刚好。'];
function maybeWelcomeBack() {
  const now = Date.now();
  if (!isActive() || chatOpen() || now - lastGreetAt < 30 * 60e3) return;
  lastGreetAt = now;
  V.setSprite('wave.png', false);
  setTimeout(() => { if (V.W.state === 'IDLE') V.setSprite('front.png', false); }, 3500);
  V.showBubble(pick(WELCOME_BACK_LINES), 4500);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60e3) maybeWelcomeBack();
  hiddenAt = 0;
});
document.addEventListener('pointermove', (e) => {
    const gap = Date.now() - lastActivity;
    lastActivity = Date.now(); // 审查#2：唤醒必须重置空闲计时，否则 10 分钟后永远秒睡
    followX = e.clientX;
    followY = e.clientY;
    // v0.6 回归问候：超过 5 分钟的动静间隔 = 主人回来了（睡醒由下方唤醒分支管，不重复）
    if (gap > 5 * 60e3 && V.W.state !== 'SLEEP') maybeWelcomeBack();
    // 主人长时间没动静 → 她打瞌睡；一有动静就醒
    if (V.W.state === 'SLEEP') {
      V.W.state = 'IDLE';
      V.setSprite('front.png', false);
      V.showBubble('唔……本鱼醒了。', 3000);
    }
  });

  // ---- 打瞌睡：主人10分钟没动静，她也睡着（呼。。。）----
  setInterval(() => {
    if (!isActive() || chatOpen() || isHome()) return;
    const idleFor = Date.now() - lastActivity;
    if (idleFor > 10 * 60e3 && V.W.state !== 'SLEEP') {
      stopMover(); // 审查四轮P2-4：散步/摇摆途中入睡，先掐掉步进循环别让她梦游
      V.W.state = 'SLEEP';
      V.setSprite('sleep.png', false); // 0.5.11：真睡姿（闭眼歪头流睡泡），不再拿滤镜凑合
      V.showHeart('呼。。。呼。。。', 5000);
    } else if (V.W.state === 'SLEEP' && Math.random() < 0.5) {
      V.showHeart(pick(['呼。。。', '哈。。。呼。。。', '呼。。。呼。。。呼。。。']), 3500);
    }
  }, 30e3);

  // follow 专用平滑循环：独立于散步调度器，随时响应鼠标（80ms 一帧）
  const CATCH_LINES = [
    '抓到啦！主人的鼠标归本鱼了！',
    '唔嘿嘿，追了半天终于抓到了～',
    '抓——到！本鱼的追击成功率百分之百！',
    '鼠标：（救命）',
  ];
  let lastCatchAt = 0;
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
      if (V.W.state === 'FOLLOW') {
        V.W.state = 'IDLE';
        V.setSprite('front.png', false);
        // 抓到光标的庆祝（0.5.15）：追上那一刻蹦跳+欢呼+飘心，20s 冷却防刷屏
        const now = Date.now();
        if (!window.__dafeiyuRetired && now - lastCatchAt > 20e3 && !chatOpen()) {
          lastCatchAt = now;
          V.hop();
          V.img.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }],
            { duration: 260, easing: 'ease-out' });
          V.setEmotion('happy', 3000);
          V.floatHearts(3);
          V.showBubble(pick(CATCH_LINES), 3500);
        }
      }
      return;
    }
    V.W.state = 'FOLLOW';
    if (Math.abs(dx) >= Math.abs(dby)) {
      V.W.dir = dx > 0 ? 1 : -1;
      V.setSpriteDir('side.png', V.W.dir);
      V.W.x = Math.max(60, Math.min(innerWidth - 60, V.W.x + V.W.dir * 3));
    } else {
      const up = dby > 0; // bottom 增大 = 往上游
      V.setSprite(up ? 'back.png' : 'front.png', false);
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
        if (++i > 20) { clearInterval(t); if (V.W._mover === t) V.W._mover = null; V.root.style.left = base + 'px'; V.W.state = 'IDLE'; }
      }, 120);
      V.W._mover = t; // 审查四轮P2-4：句柄外挂，setMode/入睡可即时掐断
      return;
    }
    if (mode === 'still') return;
    if (mode === 'follow') return; // 跟随由下方专用平滑循环接管
    // 现场核查播放状态（缓存值有 ≤10s 空窗，别让她在正片刚开播时溜达出去）
    try {
      const c = window.DafeiyuSenses ? window.DafeiyuSenses.content() : null;
      if (c && c.kind === 'video') videoPlaying = !!c.playing;
    } catch (e) { /* senses 异常就按缓存走 */ }
    if (videoPlaying) return; // 看剧礼仪：正片播放中不散步，安安静静陪看别挡字幕
    // walk
    const frames = (V.walkFrames && V.walkFrames.length > 1) ? V.walkFrames : null;
    if (!frames) return; // 行走帧未就绪：本轮跳过，等下个调度周期（不再单帧滑行）
    V.W.state = 'WALK';
    V.W.dir = Math.random() < 0.5 ? -1 : 1;
    V.setSpriteDir(frames[0], V.W.dir); // 朝向=移动方向（帧原生朝向由渲染器换算翻转）
    V.img.classList.add('dy-walk-bob'); // 行走上下起伏，告别平移滑行感
    const steps = 60 + Math.floor(Math.random() * 80);
    let i = 0;
    let f = 0;
    const t = setInterval(() => {
      // Ease-in-out: slower at start and end, faster in middle
      const progress = i / steps;
      const ease = progress < 0.3 ? 0.8 + progress * 2 : progress > 0.7 ? 2.2 - progress * 2 : 1.4;
      V.W.x = Math.max(60, Math.min(innerWidth - 60, V.W.x + V.W.dir * ease));
      V.root.style.left = V.W.x + 'px';
      // 行走帧循环：每 5 tick（200ms）换一帧，尾巴摆起来
      if (frames.length > 1 && ++f % 5 === 0) V.setSpriteDir(frames[(f / 5) % frames.length | 0], V.W.dir);
      // 观测快照：写进 DOM data 属性（隔离世界与主世界共享 DOM，QA 驱动端由此采样）
      try {
        V.root.dataset.qaState = JSON.stringify({
          st: 'WALK', x: Math.round(V.W.x), dir: V.W.dir,
          fr: decodeURIComponent((V.img.src || '').split('/').pop() || ''),
          fl: (V.flip && V.flip.style.transform) === 'scaleX(-1)',
          w: Math.round(V.img.getBoundingClientRect().width),
        });
      } catch (e) { /* 采不上就算了，不影响行走 */ }
      if (++i > steps) {
        clearInterval(t); if (V.W._mover === t) V.W._mover = null;
        V.img.classList.remove('dy-walk-bob');
        delete V.root.dataset.qaState; // 快照随散步结束清掉，别留陈值误导采样
        V.W.state = 'IDLE'; V.setSprite('front.png', false);
      }
    }, 40);
    V.W._mover = t;
  }, 4000 + Math.random() * 5000);

  // （审查#1）第二段 follow 循环已删除：与上方二维跟随循环重复，
  // 双定时器叠加会把横移速度叠成 5.5px/帧、纵横逻辑互相打架。

  // ---- 内容感知陪伴：新视频/新章节 → 本地模板即时反应 + 事件上报给缸里的本鱼 ----
  // 看剧礼仪（0.5.4）：正片播放中仍可适当说话，但更稀（≥10 分钟且低概率），
  // 且不走动挡字幕；暂停超 90 秒才轻声关心一句；换集评论限流 30 分钟。
  const PAUSE_LINES = [
    '暂停啦？本鱼帮你盯着画面，主人快去喝口水～',
    '怎么停了？卡住了还是想歇歇？本鱼在呢。',
    '去忙吧，回来按播放键就好，本鱼哪儿也不去。',
  ];
  let videoPlaying = false;
  let lastPlayingAt = 0;      // 最近一次见到正片在播的时刻（暂停关怀用，抗采样空窗）
  let pauseComfortedAt = 0;   // 上次暂停关怀的时间（每个暂停期最多关心一次）
  let lastEpComment = 0;
  let lastDanmakuReact = 0;
  // DOM 可读的弹幕关键词共情（canvas 渲染弹幕的站点读不到，自然跳过）
  const DANMAKU_REACTIONS = [
    [/前方高能|高能预警/, '（凑近屏幕）高能在哪里哪里？！本鱼也要看！'],
    [/名场面/, '这就是传说中的名场面吗，本鱼记小本本上了。'],
    [/哈哈哈哈|笑死/, '主人笑得这么开心，快告诉本鱼是什么梗嘛～'],
    [/泪目|哭了|破防/, '（默默递纸巾）呜……本鱼只是眼睛里进海水了。'],
    [/下集|更新呢|催更/, '催更大军+1！本鱼用尾巴帮你按。'],
  ];
  let lastSig = '';
  const seenSigs = [];
  // 开机立即感知一次播放状态：否则头 10 秒是空窗，她会在正片刚开始时溜达出去
  try {
    const c0 = window.DafeiyuSenses ? window.DafeiyuSenses.content() : null;
    if (c0 && c0.kind === 'video' && c0.playing) videoPlaying = true;
  } catch (e) { /* senses 未就绪就等下个周期 */ } // 页面内存级去重：全量导航天然重置；SPA 换内容由签名变化触发
  setInterval(() => {
    if (!isActive() || !window.DafeiyuSenses) return;
    let c;
    try { c = window.DafeiyuSenses.content(); } catch (e) { return; }
    // 播放状态追踪要在 kind 早退之前做，否则离开视频页后状态永远滞留。
    // 暂停关怀用"最近播放时刻"而非状态翻转：翻转靠 10s 采样可能整段错过，
    // 时间戳只要任何一帧采到过"在播"，90 秒静默后必触发。
    const playing = !!(c && c.kind === 'video' && c.playing);
    if (playing !== videoPlaying) videoPlaying = playing;
    if (playing) lastPlayingAt = Date.now();
    try { V.root.dataset.qaPause = JSON.stringify({ vp: videoPlaying, lpa: lastPlayingAt ? Math.round((Date.now() - lastPlayingAt) / 1000) : -1 }); } catch (e) {}
    if (!playing && lastPlayingAt && !chatOpen() &&
        Date.now() - lastPlayingAt > 90e3 && Date.now() - pauseComfortedAt > 120e3) {
      pauseComfortedAt = Date.now();
      V.showBubble(pick(PAUSE_LINES), 6000);
    }
    // 实时感知第 1 层（零模型）：播放器状态 + DOM 弹幕关键词
    if (playing && !chatOpen()) {
      const vid = document.querySelector('video');
      if (vid && vid.duration > 60 && vid.currentTime / vid.duration > 0.97 &&
          vid.dataset.dyNearEnd !== '1') {
        vid.dataset.dyNearEnd = '1'; // 每个视频只感慨一次，导航后自然重置
        if (Math.random() < 0.6) V.showBubble('就要看完啦……本鱼有点舍不得，再来一集吗？', 6000);
      }
      if (Date.now() - lastDanmakuReact > 8 * 60e3) {
        const texts = [...document.querySelectorAll('[class*="danmaku"] [class*="text"],[class*="danmaku-item"],.dm-info')]
          .slice(-12).map((n) => (n.textContent || '').trim()).filter((s) => s && s.length <= 30);
        const joined = texts.join(' ');
        for (const [re, line] of DANMAKU_REACTIONS) {
          if (re.test(joined)) {
            lastDanmakuReact = Date.now();
            V.showBubble(line, 5200, 'happy');
            break;
          }
        }
      }
    }
    if (!c || !c.kind || !c.title) return;
    const sig = c.kind + '|' + c.title;
    if (sig === lastSig) return;
    lastSig = sig;

    // 本地即时反应：模板填真实标题（80%概率、聊天中不打扰、换集限流30分钟）
    if (!chatOpen() && Math.random() < 0.8 && Date.now() - lastEpComment > 30 * 60e3) {
      lastEpComment = Date.now();
      const tplPool = QUIPS[c.kind + '_tpl'] || [];
      if (tplPool.length) {
        const line = pick(tplPool).replace(/\{title\}/g, c.title);
        V.showBubble(line, 5200, c.kind === 'video' ? 'happy' : 'think');
      }
    }
    // 事件上报：同签名页面内去重，新内容必报。
    // 不用 chrome.storage.session —— 它默认不对内容脚本开放（需后台 setAccessLevel 放行），
    // 未放行时 get() 直接 reject 且被静默吞掉，v0.3.2~0.3.4 的 browser_event 因此从未真正上线。
    if (!seenSigs.includes(sig)) {
      seenSigs.push(sig);
      if (seenSigs.length > 20) seenSigs.shift();
      try {
        window.DafeiyuMailbox.outbox({
          type: 'browser_event',
          kind: c.kind,
          title: c.title,
          origin: location.origin,
          excerpt: (c.excerpt || '').slice(0, 160),
        });
      } catch (e) { /* 信局不在家：静默，下个新内容再试 */ }
    }
  }, 10e3);

  // ---- 实时感知第 2 层：本地帧差（零 API、无模型也能"看见"画面）----
  // 每 2s 把视频当前帧缩到 48x27 算平均亮度差：突变=剪辑/打斗/高能；
  // 需先经历 ≥3 个平静采样（约 6 秒文戏）才反应，避免连续动作戏刷屏。
  // 跨域画布被污染时 getImageData 会抛错 → 本层整体静默停用，不影响其他。
  const MOTION_LINES = [
    '哇！这段好激烈，本鱼眼睛都快跟不上啦！',
    '（扒住缸沿）刚刚那一下看到了吗？！',
    '高能来了高能来了！本鱼鳞片都竖起来了！',
    '画面突然这么热闹……本鱼的小心脏咚咚跳。',
  ];
  const mCanvas = document.createElement('canvas');
  mCanvas.width = 48; mCanvas.height = 27;
  const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
  let prevLum = null;
  let calmStreak = 0;
  let lastMotionReact = 0;
  setInterval(() => {
    if (!videoPlaying || document.hidden || chatOpen()) return;
    const vid = document.querySelector('video');
    if (!vid || vid.paused || vid.readyState < 2 || vid.videoWidth === 0) return;
    try {
      mCtx.drawImage(vid, 0, 0, mCanvas.width, mCanvas.height);
      const d = mCtx.getImageData(0, 0, mCanvas.width, mCanvas.height).data;
      const n = d.length / 4;
      const lum = new Float32Array(n);
      let sumDiff = 0;
      for (let i = 0; i < n; i++) {
        lum[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
        if (prevLum) sumDiff += Math.abs(lum[i] - prevLum[i]);
      }
      if (prevLum) {
        const motion = sumDiff / n;
        if (motion > 26) {
          if (calmStreak >= 3 && Date.now() - lastMotionReact > 8 * 60e3 && Math.random() < 0.5) {
            lastMotionReact = Date.now();
            V.showBubble(pick(MOTION_LINES), 5200, 'happy');
          }
          calmStreak = 0;
        } else if (motion < 6) {
          calmStreak++;
        } else {
          calmStreak = 0;
        }
      }
      prevLum = lum;
    } catch (e) { prevLum = null; } // 画布污染（站点不给 CORS）：本层停用
  }, 2000);

  // ---- 信件派发（background 独家）----
  function chatAppendIfOpen(who, text) {
    if (window.DafeiyuChat && window.DafeiyuChat.isOpen()) window.DafeiyuChat.append(who, text);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PET_ACTIVE' && msg.visible) {
      tabSwitchAt = Date.now();
      homeWelcome();
      maybeMemoryQuip();
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
    } else if (msg.kind === 'celebrate') {
      // v0.6 Harness 任务庆祝：当值本鱼跑完任务经信局注入的彩信
      lastDeep = Date.now();
      V.spin(); V.hop();
      V.floatHearts(6);
      V.showBubble(msg.text || '主人！成功啦！', 6000, 'happy');
      chatAppendIfOpen('缸里的本鱼', msg.text || '任务完成，庆祝！');
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
      // not_before/expires_at 为定时券预留字段，暂无写入方，保留前置校验（审查二轮P2）
      (!t.not_before || now >= Date.parse(t.not_before)) &&
      (!t.expires_at || now <= Date.parse(t.expires_at)));
    if (idx >= 0) {
      const t = tickets.splice(idx, 1)[0];
      lastQuip = now;
      V.showBubble(t.text, 6000);
      return;
    }
    // 看剧礼仪：正片播放中闲聊更稀（距上次≥10分钟且仅15%概率）；
    // 上面的信件券不受此限——本鱼的回信什么时候都要送到
    if (videoPlaying && (now - lastQuip < 10 * 60e3 || Math.random() > 0.15)) return;
    if (force || Math.random() < 0.3) { lastQuip = now; V.showBubble(pickQuip(), 5000); }
  }
  function armQuipTimer() {
    setTimeout(() => { maybeSpeak(true); armQuipTimer(); }, 15 * 60e3 + Math.random() * 25 * 60e3);
  }
  armQuipTimer();

  // ---- 思维链心声：灰色斜体小气泡，独立于搭话冷却，更轻更频 ----
  setInterval(() => {
    if (!HEARTS.length || !isActive() || chatOpen() || videoPlaying || Math.random() > 0.45) return;
    const now = Date.now();
    if (now - lastHeart < 3 * 60e3) return;
    lastHeart = now;
    V.showHeart('（' + pick(HEARTS) + '）', 5200);
  }, 4 * 60e3);

  // ---- 电量彩蛋（一次性）----
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      if (!b.charging && b.level < 0.2) {
        setTimeout(() => { if (isActive()) V.showBubble('主人的设备饿电了…记得喂它呀⚡', 6000); }, 60e3);
      }
    }).catch(() => {});
  }

  // 供渲染器自愈守卫在重挂节点后立刻恢复徽章场景色
  window.DafeiyuView && (window.DafeiyuView.refreshBadge = refreshBadge);

  // ---- v0.6 自主小动作：主人没搭理她时，她自己找点事做（低频/短时/不打扰）----
  const SOLO_LINES = ['本鱼正在研究为什么网页底部这么宽。', '主人不理本鱼，本鱼决定自己玩。', '（趴在缸底假装珊瑚）'];
  let lastSoloAt = 0;
  setInterval(() => {
    if (window.__dafeiyuRetired || !isActive() || V.W.state !== 'IDLE' || chatOpen() || videoPlaying) return;
    const now = Date.now();
    if (now - lastSoloAt < 45e3 || Math.random() > 0.3) return;
    lastSoloAt = now;
    const act = ['tail', 'peek', 'lie', 'talk'][Math.floor(Math.random() * 4)];
    if (act === 'tail') {
      V.spin();
      if (Math.random() < 0.5) V.showHeart('（追自己的尾巴）……抓到了！……再放掉。', 4200);
    } else if (act === 'peek') {
      V.setSpriteDir('side.png', (followX ?? V.W.x) > V.W.x ? 1 : -1); // 凑近偷看鼠标
      setTimeout(() => { if (V.W.state === 'IDLE') V.setSprite('front.png', false); }, 2500);
    } else if (act === 'lie') {
      V.setSprite('sleep.png', false);
      V.showBubble(pick(['主人不理本鱼，本鱼决定自己玩。', '（趴在缸底假装珊瑚）']), 4200);
      setTimeout(() => { if (V.W.state === 'IDLE') V.setSprite('front.png', false); }, 5000);
    } else {
      V.showHeart('（' + pick(SOLO_LINES) + '）', 4500);
    }
  }, 60e3);

  // ---- v0.6 短期浏览记忆：background 记域名流水，切 Tab 回来低概率感慨 ----
  let lastMemQuip = 0;
  async function maybeMemoryQuip() {
    const now = Date.now();
    if (window.__dafeiyuRetired || !isActive() || chatOpen() || now - lastMemQuip < 15 * 60e3 || Math.random() > 0.25) return;
    try {
      const { browse_log = [] } = await chrome.storage.local.get('browse_log');
      const dayAgo = now - 24 * 3600e3;
      const counts = {};
      for (const e of browse_log) if (e.t >= dayAgo) counts[e.d] = (counts[e.d] || 0) + 1;
      const n = counts[location.hostname] || 0;
      if (n >= 3) {
        lastMemQuip = now;
        lastQuip = now; // 占用台词冷却，不与搭话叠加
        V.showBubble(n >= 6 ? `今天第 ${n} 次回到 ${location.hostname} 了呢，主人。`
                            : `又游回 ${location.hostname} 啦？本鱼还以为你今天要彻底摸鱼了。`, 5500);
      }
    } catch (e) { /* storage 不可达就当没有 */ }
  }

  window.DafeiyuBehavior = {
    pickQuip,
    getMode: () => mode,
    setMode,
    markDeep: () => { lastDeep = Date.now(); },
    markQuip: () => { lastQuip = Date.now(); },
  };
})();
