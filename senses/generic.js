(() => {
  window.DafeiyuSenses = {
    // v1 仅 L0：标题 + 脱敏后的 URL（丢 query/fragment）。不看表单、不看正文。
    capture() {
      const s = window.DafeiyuSanitize.sanitizeUrl(location.href);
      return {
        title: (document.title || '').slice(0, 120),
        url: s.url,
        origin: s.origin,
        domain: s.domain,
      };
    },
  };
})();
