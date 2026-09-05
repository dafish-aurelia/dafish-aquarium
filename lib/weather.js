(function (global) {
  'use strict';
  // 天气感知（v0.9）：WMO 代码分组、台词池、缓存新鲜度、geocoding 响应解析。
  // 网络请求一律不在这里做——本文件是纯函数，background 负责取数。
  // 注意：WMO 分组在 background.js 有内联副本，改这里必须同步改那边。
  const WMO_POOLS = [
    { codes: [0, 1], pool: 'clear' },
    { codes: [2, 3], pool: 'cloud' },
    { codes: [45, 48], pool: 'fog' },
    { codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], pool: 'rain' },
    { codes: [71, 73, 75, 77, 85, 86], pool: 'snow' },
    { codes: [95, 96, 99], pool: 'storm' },
  ];
  function wmoToPool(code) {
    if (code === null || code === undefined || Number.isNaN(code)) return 'unknown';
    for (const g of WMO_POOLS) {
      if (g.codes.includes(code)) return g.pool;
    }
    return 'unknown';
  }
  const WEATHER_QUIPS = {
    clear: [
      '外面是大晴天，本鱼的缸都亮了一度。',
      '阳光正好，主人的窗边位置让给本鱼晒晒？',
      '晴天的浏览器都比平时蓝一点，你发现过吗？',
      '（贴着缸壁看外面）今天的天空没有一丝杂质。',
    ],
    cloud: [
      '阴天最适合窝着，本鱼把水温调得刚刚好。',
      '云有点多，但摸鱼的亮度刚好。',
      '灰蒙蒙的天，本鱼负责给主人一点亮色。',
    ],
    rain: [
      '外面在下雨，本鱼的缸里也在冒泡。',
      '雨天的键盘声听起来像小溪，主人听到了吗？',
      '记得把伞放在门口，本鱼提前替主人看过了。',
    ],
    snow: [
      '下雪了！本鱼虽然是温水鱼，也想堆个雪鱼。',
      '雪天的世界安静得像深海，适合早点休息。',
      '主人出门小心路滑，本鱼在缸里替你担心。',
    ],
    storm: [
      '打雷了，本鱼潜到缸底躲一躲。',
      '雷雨天记得拔掉不用的电器，本鱼操心的很。',
      '风雨交加的日子，早点回家陪本鱼。',
    ],
    fog: [
      '起雾了，主人的屏幕外一片朦胧。',
      '雾天走路慢一点，本鱼不想主人撞到缸。',
      '（雾蒙蒙地贴着缸壁）咦，主人刚才是不是路过？',
    ],
    unknown: [
      '天气API说了个本鱼没见过的代码，就当是神秘海域。',
      '今天的天气是个谜，本鱼选择优雅地潜水。',
      '不知道外面什么天气，反正缸里四季恒温。',
    ],
  };
  const ADVISORY_QUIPS = {
    umbrella: ['降水概率不小，出门记得带伞。'],
    hot: ['气温有点高，主人多喝水，本鱼帮你冰着。'],
    cold: ['降温了，加件外套再出门，本鱼会把水温调高一点。'],
  };
  function advisoryPool(wx) {
    if (!wx) return null;
    const precip = Number(wx.precip) || 0;
    const temp = Number(wx.temp);
    if (precip >= 60) return ADVISORY_QUIPS.umbrella;
    if (!Number.isNaN(temp)) {
      if (temp >= 34) return ADVISORY_QUIPS.hot;
      if (temp <= 0) return ADVISORY_QUIPS.cold;
    }
    return null;
  }
  // 缓存新鲜度：30 分钟内的天气数据可直接复用
  const FRESH_MS = 30 * 60 * 1000;
  function isFresh(cache) {
    if (!cache || !cache.ts) return false;
    return Date.now() - cache.ts < FRESH_MS;
  }
  // open-meteo geocoding API 响应解析：取第一个结果的经纬度
  function parseGeocode(body) {
    if (!body || !Array.isArray(body.results) || !body.results[0]) return null;
    const r = body.results[0];
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
    return { latitude: r.latitude, longitude: r.longitude };
  }
  const api = {
    wmoToPool,
    WMO_POOLS,
    WEATHER_QUIPS,
    ADVISORY_QUIPS,
    advisoryPool,
    FRESH_MS,
    isFresh,
    parseGeocode,
  };
  global.DafeiyuWeather = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
