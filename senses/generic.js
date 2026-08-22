(() => {
  // 场景感知 L0：按域名判断主人正在干嘛（收编自昨天版 content.js 的场景正则）
  const WORK = /(^|\.)github\.com$|(^|\.)stackoverflow\.com$|(^|\.)gitee\.com$|(^|\.)juejin\.cn$|(^|\.)csdn\.net$/;
  const VIDEO = /(^|\.)bilibili\.com$|(^|\.)youtube\.com$|(^|\.)iqiyi\.com$|(^|\.)youku\.com$|(^|\.)netflix\.com$/;

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
    scene() {
      try {
        const h = location.hostname;
        if (WORK.test(h)) return 'work';
        if (VIDEO.test(h)) return 'video';
        if (decodeURIComponent(location.href)
          .startsWith('file:///G:/life/Aurelia的工作区/browser/start.html')) return 'home';
      } catch (e) { /* 忽略 */ }
      return 'chill';
    },
  };
})();
