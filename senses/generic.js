(() => {
  // 场景感知：L0 域名场景 + L1 内容签名（视频/小说，仅白名单站点提取标题与有限摘录）
  const WORK = /(^|\.)github\.com$|(^|\.)stackoverflow\.com$|(^|\.)gitee\.com$|(^|\.)juejin\.cn$|(^|\.)csdn\.net$/;
  const VIDEO = /(^|\.)bilibili\.com$|(^|\.)youtube\.com$|(^|\.)iqiyi\.com$|(^|\.)youku\.com$|(^|\.)netflix\.com$/;
  const NOVEL = /(^|\.)qidian\.com$|(^|\.)jjwxc\.net$|(^|\.)69shu(?:ba)?\.(com|net)$|(^|\.)sfacg\.com$|(^|\.)ciweimao\.com$|(^|\.)zongheng\.com$/;

  function homeNow() {
    try {
      const h = window.DafeiyuSanitize.HOME_URL;
      // v0.8：默认空串 = 珊瑚礁页即家；空前缀会匹配一切页面，
      // 必须显式判空，否则任何网页都会被误判为"家"。
      return !!h && decodeURIComponent(location.href).startsWith(h);
    } catch (e) { return false; }
  }

  function scene() {
    try {
      const h = location.hostname;
      if (WORK.test(h)) return 'work';
      if (VIDEO.test(h)) return 'video';
      if (NOVEL.test(h)) return 'novel';
      if (homeNow()) return 'home';
    } catch (e) { /* 忽略 */ }
    return 'chill';
  }

  // 内容签名：只在视频/小说白名单站点提取，摘录上限 160 字符
  function content() {
    const s = scene();
    try {
      if (s === 'video') {
        const el = document.querySelector(
          'ytd-watch-metadata #title, h1.title, .video-title, .video-info-title h1, h1');
        const vids = [...document.querySelectorAll('video')];
        const playing = vids.some((v) => !v.paused && !v.ended && v.currentTime > 0);
        return {
          kind: 'video',
          title: ((el && el.textContent) || document.title || '').trim().slice(0, 80),
          playing,
          excerpt: '',
        };
      }
      if (s === 'novel') {
        const t = document.querySelector('.chapter-title, h2, h1, #bookName, .book-title');
        const paras = [...document.querySelectorAll('p')]
          .map((p) => (p.textContent || '').trim())
          .filter((x) => x.length > 30);
        return {
          kind: 'novel',
          title: ((t && t.textContent) || document.title || '').trim().slice(0, 60),
          playing: null,
          excerpt: (paras[0] || '').slice(0, 160),
        };
      }
    } catch (e) { /* 忽略 */ }
    return { kind: null, title: (document.title || '').slice(0, 80), playing: null, excerpt: '' };
  }

  // v0.9 天气视图：只读 storage 缓存（拉取在 background，本层零网络）。
  // stale=true 的旧数据也照给——behavior 层自己决定要不要用（advisory 会跳过）。
  let _wx = null;
  try {
    chrome.storage.local.get('weather_cache').then(({ weather_cache }) => { _wx = weather_cache || null; }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.weather_cache) _wx = ch.weather_cache.newValue || null;
    });
  } catch (e) { /* 非扩展上下文（node 测试） */ }
  function weather() { return _wx; }

  window.DafeiyuSenses = {
    capture() {
      const s = window.DafeiyuSanitize.sanitizeUrl(location.href);
      return {
        title: (document.title || '').slice(0, 120),
        url: s.url,
        origin: s.origin,
        domain: s.domain,
      };
    },
    scene,
    homeNow,
    content,
    weather,
  };
})();
