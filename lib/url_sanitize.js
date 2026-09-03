(function (global) {
  'use strict';
  // URL 脱敏：丢弃 query 与 fragment，仅保留 origin + path。
  // 信封里只允许出现这里的产物（隐私边界，见设计文档 §4.1）。
  function sanitizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      return { url: u.origin + u.pathname, origin: u.origin, domain: u.hostname };
    } catch (e) {
      return { url: '', origin: '', domain: '' };
    }
  }
  // 水缸主页（v0.8 起不再硬编码出厂路径）：
  // 默认空串 = 珊瑚礁页（newtab.html）就是家；
  // 用户在设置页显式填 storage.home_url 才跳外部页面（file:// 或 https://）。
  const DEFAULT_HOME = '';
  global.DafeiyuSanitize = {
    sanitizeUrl,
    HOME_URL: DEFAULT_HOME,
    DEFAULT_HOME,
    setHomeUrl(u) { if (typeof u === 'string') this.HOME_URL = u; },
  };
  // 各上下文启动时拉一次覆盖值（storage 不可达时静默用默认）
  try {
    chrome.storage.local.get('home_url').then(({ home_url }) => {
      if (home_url) global.DafeiyuSanitize.setHomeUrl(home_url);
    }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.home_url) global.DafeiyuSanitize.setHomeUrl(ch.home_url.newValue);
    });
  } catch (e) { /* 非扩展上下文（如 node 测试） */ }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeUrl };
  }
})(typeof window !== 'undefined' ? window : globalThis);
