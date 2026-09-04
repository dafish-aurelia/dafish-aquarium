(function (global) {
  'use strict';
  // TTS 决策纯函数（v0.9）：enabled 开关 × provider 分支。
  // provider 本期只有 'chrome'（chrome.tts 系统音）；以后加网络音源在这里放行。

  function shouldSpeak(cfg, provider) {
    if (!cfg || cfg.enabled !== true) return false;
    return provider === 'chrome';
  }

  const api = { shouldSpeak };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DafeiyuVoiceRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
