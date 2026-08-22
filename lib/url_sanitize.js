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
  global.DafeiyuSanitize = { sanitizeUrl };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeUrl };
  }
})(typeof window !== 'undefined' ? window : globalThis);
