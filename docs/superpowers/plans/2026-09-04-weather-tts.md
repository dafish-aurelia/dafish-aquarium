# v0.9.0 天气感知 + TTS 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准的设计文档 `docs/superpowers/specs/2026-09-04-weather-tts-design.md` 落地三件事：Open-Meteo 天气拉取（城市级、SW 直拉、30min 缓存）、天气场景语录（挂进 pickQuip 概率体系 + 雨晴切换播报）、TTS 说话接口（chrome.tts 系统音、默认关、留 provider 分支）。

**Architecture:** 天气数据流：设置页存 `weather_city` → SW `pet-weather` alarm 每 30min 经 geocoding（城市→经纬度，缓存 1 天）+ forecast（经纬度→天气，缓存 30min）写 `weather_cache` storage → 内容脚本经 storage.onChanged 读 `DafeiyuSenses.weather()` → behavior 层 pickQuip 以 15% 概率从 WMO 分组池挑词。TTS：`DafeiyuVoice.speak()` 落 renderer.js，内部 `tts_provider` 分支（本期恒 'chrome'）→ chrome.tts；默认关，宠物 ⚙️ 面板 + settings.html 各有开关。

**Tech Stack:** Chrome MV3 原生 JS · Open-Meteo 免 key API（geocoding-api + api 两个域名）+ ipapi.co（IP 检测，可选按钮）· node:test 单测（WMO 映射纯函数）· 无构建步骤。

---

## 现状基线（动手前必读）

- 仓库：`G:\life\Aurelia的工作区\apps\dafeiyu-extension`，分支 `main`，工作树干净（HEAD 含 quip 优化）。
- 测试基线：pytest 57 passed · node --test 3 passed（url_sanitize）。
- manifest 权限现为 `storage/alarms/tabs/nativeMessaging` + host `http://127.0.0.1/*`。
- background.js 的 alarm 处理集中在 `onAlarm` 监听器（:116）+ 底部兜底 create 区（:207-210）；消息路由在 `onMessage` switch（:285+）。
- `pet/behavior.js` 的 pickQuip/pickFresh/SLOT_QUIPS 已就位（v0.8.5），本期概率从 45/20/…改为 45 场景/20 时段/15 天气/20 通用。
- `senses/generic.js` 暴露 `window.DafeiyuSenses`，`capture()/scene()/homeNow()/content()` 四方法。
- 本机实测：Open-Meteo 需经系统代理（Chrome SW 自动走，无碍）；直连 TLS 失败是 curl 特有，不影响扩展。
- 测试文件模式参考 `tests/url_sanitize.test.mjs`（node:test + createRequire）。
- 文件普遍带 UTF-8 BOM（settings.html/settings_page.js 是，newtab/behavior 否）——新文件统一**无 BOM、LF**（匹配 behavior.js 先例）。

---

### Task 1: 天气纯函数库 lib/weather.js（WMO 映射 + 台词池）

**Files:**
- Create: `lib/weather.js`
- Test: `tests/weather.test.mjs`

- [ ] **Step 1: 写失败测试** `tests/weather.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url); // 顶部还需 import { createRequire } from 'node:module';
const W = require('../lib/weather.js');

test('WMO code 映射到池名', () => {
  assert.equal(W.wmoToPool(0), 'clear');
  assert.equal(W.wmoToPool(1), 'clear');
  assert.equal(W.wmoToPool(2), 'cloud');
  assert.equal(W.wmoToPool(3), 'cloud');
  assert.equal(W.wmoToPool(61), 'rain');
  assert.equal(W.wmoToPool(80), 'rain');
  assert.equal(W.wmoToPool(71), 'snow');
  assert.equal(W.wmoToPool(95), 'storm');
  assert.equal(W.wmoToPool(45), 'fog');
  assert.equal(W.wmoToPool(99), 'unknown'); // 未知码兜底
});

test('天气池存在且无空池', () => {
  for (const p of ['clear', 'cloud', 'rain', 'snow', 'storm', 'fog', 'unknown']) {
    assert.ok(W.WEATHER_QUIPS[p].length >= 3, `池 ${p} 至少 3 条`);
    for (const line of W.WEATHER_QUIPS[p]) assert.ok(line.length > 0);
  }
});

test('提醒池选择：降水概率与极端气温', () => {
  assert.equal(W.advisoryPool({ precip: 70, temp: 25 }), W.ADVISORY_QUIPS.umbrella);
  assert.equal(W.advisoryPool({ precip: 20, temp: 25 }), null);
  assert.equal(W.advisoryPool({ precip: 10, temp: 36 }), W.ADVISORY_QUIPS.hot);
  assert.equal(W.advisoryPool({ precip: 10, temp: -2 }), W.ADVISORY_QUIPS.cold);
  assert.equal(W.advisoryPool({ precip: 10, temp: 25 }), null);
});

test('天气缓存新鲜度判断', () => {
  const now = Date.now();
  assert.equal(W.isFresh({ ts: now - 29 * 60e3 }), true);
  assert.equal(W.isFresh({ ts: now - 31 * 60e3 }), false);
  assert.equal(W.isFresh(null), false);
  assert.equal(W.isFresh(undefined), false);
});

test('geocoding 结果解析', () => {
  const body = { results: [{ latitude: 31.2, longitude: 121.5, name: 'Shanghai', country: 'China' }] };
  assert.deepEqual(W.parseGeocode(body), { lat: 31.2, lon: 121.5 });
  assert.equal(W.parseGeocode({ results: [] }), null);
  assert.equal(W.parseGeocode({}), null);
});
```

- [ ] **Step 2: 跑测试确认失败**：`node --test tests/weather.test.mjs` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `lib/weather.js`**（IIFE 风格与 url_sanitize.js 同构；node require 可用需 module.exports）：

```javascript
(function (global) {
  'use strict';
  // 天气感知（v0.9）：WMO 代码分组、台词池、缓存新鲜度、geocoding 解析。
  // 网络请求一律不在这里做——本文件是纯函数，background 负责 fetch。

  const WMO_POOLS = [
    { pool: 'clear', codes: [0, 1] },
    { pool: 'cloud', codes: [2, 3] },
    { pool: 'fog', codes: [45, 48] },
    { pool: 'rain', codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82] },
    { pool: 'snow', codes: [71, 73, 75, 77, 85, 86] },
    { pool: 'storm', codes: [95, 96, 99] },
  ];

  function wmoToPool(code) {
    if (typeof code !== 'number' || Number.isNaN(code)) return 'unknown';
    for (const g of WMO_POOLS) if (g.codes.includes(code)) return g.pool;
    return 'unknown';
  }

  const WEATHER_QUIPS = {
    clear: [
      '外面是大晴天，本鱼的缸都亮了一度。',
      '阳光正好，主人的窗边位置让给本鱼晒晒？',
      '这么好的天，下班路上别急着回家，慢慢走。',
      '晴天的浏览器都比平时蓝一点，你发现过吗？',
      '（贴着缸壁看外面）今天的天空没有一丝杂质。',
    ],
    cloud: [
      '阴天最适合窝着，本鱼把水温调 comfy 了。',
      '云有点多，但摸鱼的亮度刚好。',
      '这种天气，显示器显得特别亮。',
      '灰蒙蒙的天，本鱼给你当一点颜色。',
    ],
    rain: [
      '外面在下雨，本鱼帮你盯着窗户。',
      '雨声其实很像深海，主人在陆地上也能听见海。',
      '下雨天和热汤是标配，本鱼只负责提醒。',
      '（听雨）这种天气加班的，都是勇士。',
      '雨刮器今天会辛苦一点，替本鱼谢谢它。',
    ],
    snow: [
      '下雪了！本鱼这辈子没见过雪，多看两眼。',
      '雪天路滑，主人出门像企鹅一样走。',
      '外面白茫茫的，缸里也跟着安静。',
      '雪花落在水面会立刻化掉——本鱼查过的。',
    ],
    storm: [
      '雷雨天记得拔掉不必要的电——本鱼怕你被吓到。',
      '打雷的时候本鱼缸会震一下，就当按摩。',
      '这种天还出门的人，本鱼敬佩你。',
    ],
    fog: [
      '雾天的世界像加了磨砂滤镜。',
      '（透过雾看主人）今天你也是朦胧美。',
      '雾天开车要慢，本鱼坐副驾提醒你。',
    ],
    unknown: [
      '天气API说了个本鱼没见过的代码，就当是神秘海域。',
      '今天的天气是个谜，本鱼不猜了。',
      '天气情报员今天请假了，本鱼凭水温播报。',
    ],
  };

  const ADVISORY_QUIPS = {
    umbrella: [
      '降水概率有点高，包里塞把伞，本鱼不背淋雨的锅。',
      '今天大概率下雨——伞！伞！伞！',
    ],
    hot: [
      '今天非常热，别在正午乱跑，学本鱼潜到水底。',
      '高温警报：多喝水，本鱼递缸水你不合适就算了。',
    ],
    cold: [
      '跌破零度了，围巾围上，本鱼靠一身鲸脂但你不行。',
      '冷到本鱼都想结冰了，主人保暖第一。',
    ],
  };

  function advisoryPool(wx) {
    if (!wx) return null;
    const precip = Number(wx.precip) || 0;
    const temp = Number(wx.temp);
    if (precip >= 60) return ADVISORY_QUIPS.umbrella;
    if (typeof temp === 'number' && temp >= 34) return ADVISORY_QUIPS.hot;
    if (typeof temp === 'number' && temp <= 0) return ADVISORY_QUIPS.cold;
    return null;
  }

  const FRESH_MS = 30 * 60e3;
  function isFresh(cache) {
    if (!cache || typeof cache.ts !== 'number') return false;
    return Date.now() - cache.ts < FRESH_MS;
  }

  function parseGeocode(body) {
    const r = body && body.results && body.results[0];
    if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
    return { lat: r.latitude, lon: r.longitude };
  }

  const api = { wmoToPool, WEATHER_QUIPS, ADVISORY_QUIPS, advisoryPool, isFresh, parseGeocode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DafeiyuWeather = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: 跑测试确认通过**：`node --test tests/weather.test.mjs` → 5+ pass。
- [ ] **Step 5: Commit**：`git add lib/weather.js tests/weather.test.mjs && git commit -m "feat(weather): WMO pool mapping, quip pools, cache freshness pure functions"`

---

### Task 2: manifest 权限与 content_scripts 注入

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: 权限与域名**——`permissions` 数组加 `"tts"`；`host_permissions` 加三个域名：

```json
  "permissions": ["storage", "alarms", "tabs", "nativeMessaging", "tts"],
  "host_permissions": [
    "http://127.0.0.1/*",
    "https://geocoding-api.open-meteo.com/*",
    "https://api.open-meteo.com/*",
    "https://ipapi.co/*"
  ]
```

- [ ] **Step 2: content_scripts.js 注入顺序**——在 `lib/url_sanitize.js` 之后、`senses/generic.js` 之前插 `lib/weather.js`（senses 和 behavior 都要读它）：

```json
      "js": [
        "lib/url_sanitize.js",
        "lib/weather.js",
        "mailbox/client.js",
        "senses/generic.js",
        "pet/renderer.js",
        "pet/behavior.js",
        "pet/interaction.js"
      ]
```

- [ ] **Step 3: 校验 JSON**：`python -c "import json; json.load(open('manifest.json', encoding='utf-8')); print('OK')"`；同时 `node --check` 不适用 JSON，跳过。
- [ ] **Step 4: Commit**（含版本号升 `0.9.0`）：`git add manifest.json && git commit -m "feat(manifest): v0.9.0 — tts permission, weather API hosts, weather.js injection"`，version 字段改 `"0.9.0"`。

---

### Task 3: background.js 天气拉取 + alarm + 变化播报

**Files:**
- Modify: `background.js`
- Test: 手工冒烟（网络+代理环境不可单测）

- [ ] **Step 1: 模块顶加常量**（PORT_DEFAULT 附近）：

```javascript
// ---- v0.9 天气感知 ----
const WX_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const WX_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const WX_IPAPI = 'https://ipapi.co/json/';
```

- [ ] **Step 2: SW 顶部 importScripts**——background.js 是经典脚本，无 import 机制；把 Task 1 的纯函数**以最小副本**带入：只在 SW 里用 `parseGeocode`/`isFresh` 两个函数，直接在文件顶部内联（8 行，避免 importScripts 的额外文件清单维护）：

```javascript
function _wxParseGeocode(body) {
  const r = body && body.results && body.results[0];
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  return { lat: r.latitude, lon: r.longitude };
}
const WX_FRESH_MS = 30 * 60e3;
function _wxIsFresh(c) { return !!(c && typeof c.ts === 'number' && Date.now() - c.ts < WX_FRESH_MS); }
```

- [ ] **Step 3: 拉取函数**（放在 connectGatekeeper 之前）：

```javascript
// 城市名 → 经纬度（缓存 1 天于 storage.weather_geo）；失败返回 null
async function wxResolveCity(city) {
  const { weather_geo } = await chrome.storage.local.get('weather_geo');
  if (weather_geo && weather_geo.city === city && Date.now() - weather_geo.ts < 86400e3) {
    return { lat: weather_geo.lat, lon: weather_geo.lon };
  }
  try {
    const r = await fetch(`${WX_GEO}?name=${encodeURIComponent(city)}&count=1&language=zh`);
    const g = _wxParseGeocode(await r.json());
    if (!g) return null;
    await chrome.storage.local.set({ weather_geo: { city, lat: g.lat, lon: g.lon, ts: Date.now() } });
    return g;
  } catch (e) { return null; }
}

// 经纬度 → 天气快照 { code, temp, precip, city, ts }；失败用旧缓存并标 stale
async function wxFetch() {
  const { weather_city = '' } = await chrome.storage.local.get('weather_city');
  if (!weather_city) return;
  const { weather_cache: old } = await chrome.storage.local.get('weather_cache');
  const geo = await wxResolveCity(weather_city);
  if (!geo) { if (old) chrome.storage.local.set({ weather_cache: { ...old, stale: true } }); return; }
  try {
    const r = await fetch(`${WX_FORECAST}?latitude=${geo.lat}&longitude=${geo.lon}` +
      `&current=temperature_2m,weather_code&daily=precipitation_probability_max&forecast_days=1&timezone=auto`);
    const d = await r.json();
    const wx = {
      code: d.current.weather_code,
      temp: d.current.temperature_2m,
      precip: (d.daily.precipitation_probability_max || [0])[0],
      city: weather_city,
      ts: Date.now(),
      stale: false,
    };
    await chrome.storage.local.set({ weather_cache: wx });
    // 雨晴切换播报：旧缓存池名与新不同且不新鲜（跨两轮拉取），经信局广播一句
    if (old && !_wxIsFresh(old) && old.code !== undefined) {
      const aPool = lib_wmoPool(old.code), bPool = lib_wmoPool(wx.code);
      if (aPool !== bPool && (aPool === 'rain') !== (bPool === 'rain')) {
        try {
          await mbJson('/api/inject', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'weather_shift', text: '', from: aPool, to: bPool }),
          });
        } catch (e) { /* 信局不在就跳过播报，不是错 */ }
      }
    }
  } catch (e) {
    if (old) chrome.storage.local.set({ weather_cache: { ...old, stale: true } });
  }
}
```

注意：上面 `lib_wmoPool` 需要——SW 里再内联 wmoToPool 的分组表（WMO_POOLS 数组 + 函数，约 10 行，与 Task 1 lib/weather.js 保持同步；**在两处文件头都加注释"分组表有副本，改一处必须改另一处"**）。

- [ ] **Step 4: alarm 与兜底注册**——`onAlarm` 监听器内加一行；底部兜底 create 区加一行：

```javascript
// onAlarm 内：
if (alarm.name === 'pet-weather') { wxFetch().catch(() => {}); }
// 兜底区（:210 附近）：
chrome.alarms.create('pet-weather', { periodInMinutes: 30 }); // v0.9 天气缓存
```

并在 SW 顶层启动时补一次（`accumulateMood(); postHeartbeat();` 之后）加 `wxFetch().catch(() => {});`——冷启动别等 30 分钟。

- [ ] **Step 5: 消息路由**——`onMessage` switch 加两个 case（IP 检测按钮用；天气城市读写在 settings 页直接用 chrome.storage，不经 SW）：

```javascript
case 'WEATHER_IP_DETECT': {
  try {
    const r = await fetch(WX_IPAPI);
    const d = await r.json();
    sendResponse({ ok: true, city: d.city || '', ip: d.ip || '' });
  } catch (e) { sendResponse({ ok: false }); }
  break;
}
```

- [ ] **Step 6: 验证**：`node --check background.js`；手工冒烟由控制器做（见 Task 7）。
- [ ] **Step 7: Commit**：`git add background.js && git commit -m "feat(weather): SW-side fetch pipeline, geo cache, rain-shift broadcast, IP detect"`。

---

### Task 4: senses 层天气视图 + behavior 概率重分配

**Files:**
- Modify: `senses/generic.js`
- Modify: `pet/behavior.js`

- [ ] **Step 1: senses/generic.js 暴露 weather()**（window.DafeiyuSenses 对象里加；storage.onChanged 同步内存副本）：

```javascript
  // v0.9 天气视图：只读 storage 缓存，自己不发请求（拉取在 background）
  let _wx = null;
  try {
    chrome.storage.local.get('weather_cache').then(({ weather_cache }) => { _wx = weather_cache || null; }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.weather_cache) _wx = ch.weather_cache.newValue || null;
    });
  } catch (e) { /* 非扩展上下文 */ }
  // 在暴露对象里加：
  weather() { return _wx && !_wx.stale ? _wx : (_wx || null); },
```

（暴露对象里的实际写法：`window.DafeiyuSenses = { capture, scene, homeNow, content, weather };` 中的 `weather` 是具名函数 `function weather() {…}`。）

- [ ] **Step 2: behavior.js 概率重分配 + 天气混入**——改 pickQuip：

```javascript
  // 场景感知台词：45% 应景场景、20% 时段、15% 天气、20% 通用兜底
  // （v0.9：天气入列；天气未知时配额自动回落通用——离线零降级感）
  function pickQuip() {
    const r = Math.random();
    const slot = SLOT_QUIPS[daySlot()] || [];
    let line = '';
    if (r < 0.45) {
      const scene = window.DafeiyuSenses ? window.DafeiyuSenses.scene() : 'chill';
      const pool = QUIPS[scene] && QUIPS[scene].length ? QUIPS[scene] : QUIPS.generic;
      line = pickFresh(scene, pool);
    } else if (r < 0.65 && slot.length) {
      line = pickFresh('slot:' + daySlot(), slot);
    } else if (r < 0.80) {
      const wx = window.DafeiyuSenses && window.DafeiyuSenses.weather();
      const W = window.DafeiyuWeather;
      if (wx && W) {
        const adv = W.advisoryPool(wx);
        const pool = adv || W.WEATHER_QUIPS[W.wmoToPool(wx.code)];
        line = pickFresh('weather:' + (adv ? 'adv' : W.wmoToPool(wx.code)), pool);
      }
    }
    if (!line) line = pickFresh('generic', QUIPS.generic);
    return line || '咕噜噜……';
  }
```

- [ ] **Step 3: 天气显著变化播报的接收端**——behavior.js 里已有 PET_MESSAGE 处理（广播链路）。找到处理 `m.type === 'PET_MESSAGE'` 的位置（inboxLoop 广播的 `kind` 字段），给 `kind === 'weather_shift'` 加专门台词分支：

在 PET_MESSAGE 监听处（renderer.js 也有一个，注意别改错——**behavior.js 内**的那个）：

```javascript
// v0.9 天气切换播报（信局 weather_shift → 广播）：不说空文本，现场生成
if (m.kind === 'weather_shift') {
  const pools = { rain: ['雨停啦，太阳回来了！', '天晴了，主人晾心情的好时候。'],
                  clear: ['要下雨了的样子，本鱼先把伞挂门口。', '云压过来了，雨可能在路上。'] };
  const p = pools[m.to === 'rain' ? 'rain' : 'clear'] || [];
  if (p.length) V.showBubble(pickFresh('wxshift', p), 5000);
  return;
}
```

（`m.to` 为新天气池名；从雨切换到任何非雨都按"雨停"说，切到雨按"要下雨"说。）

- [ ] **Step 4: 验证**：`node --check senses/generic.js pet/behavior.js`；`node --test tests/`（url_sanitize + weather 全过）。
- [ ] **Step 5: Commit**：`git add senses/generic.js pet/behavior.js && git commit -m "feat(weather): senses read-view, pickQuip 15% weather share, shift broadcast lines"`。

---

### Task 5: TTS 接口 DafeiyuVoice + 朗读挂钩

**Files:**
- Modify: `pet/renderer.js`
- Modify: `pet/interaction.js`（气泡朗读挂钩 + ⚙️ 面板 TTS 开关）
- Test: `tests/voice.test.mjs`（provider 分支纯函数）

- [ ] **Step 1: 写失败测试** `tests/voice.test.mjs`：

```js
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const V = require('../pet/renderer.js'); // renderer.js 目前无 module.exports——见 Step 2 说明
```

**注意**：renderer.js 重度依赖 chrome.*，node 里加载它会炸。**不测 renderer 整体**，只测 provider 分支——把分支逻辑写成可导出的纯函数放 lib/weather.js 同级新文件 `lib/voice.js`：

```js
// tests/voice.test.mjs
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const voice = require('../lib/voice.js');

test('speak 决策：开关关闭时静默', () => {
  assert.equal(voice.shouldSpeak({ enabled: false }, 'chrome'), false);
  assert.equal(voice.shouldSpeak({ enabled: true }, 'chrome'), true);
  assert.equal(voice.shouldSpeak({}, 'chrome'), false); // 未配置默认关
});

test('speak 决策：未知 provider 静默（未来音源未接入时不炸）', () => {
  assert.equal(voice.shouldSpeak({ enabled: true }, 'siliconflow-tts'), false);
});
```

- [ ] **Step 2: 实现 `lib/voice.js`**：

```javascript
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
```

- [ ] **Step 3: renderer.js 落 DafeiyuVoice**（在 window.DafeiyuView = DafeiyuView; 之后）：

```javascript
  // ---- v0.9 TTS 接口：先接 chrome.tts 系统音，默认关 ----
  // 换音源的口子：provider 分支（本期恒 'chrome'），以后接网络 TTS 只改 speak 内部。
  let _voiceCfg = { enabled: false, provider: 'chrome' };
  try {
    chrome.storage.local.get('tts_enabled').then(({ tts_enabled }) => {
      _voiceCfg.enabled = tts_enabled === true;
    }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.tts_enabled) _voiceCfg.enabled = ch.tts_enabled.newValue === true;
    });
  } catch (e) { /* 非扩展上下文 */ }

  window.DafeiyuVoice = {
    enabled() { return _voiceCfg.enabled; },
    speak(text) {
      const D = window.DafeiyuVoiceRules;
      if (!D || !D.shouldSpeak({ enabled: _voiceCfg.enabled }, 'chrome')) return;
      try {
        chrome.tts.speak(String(text || ''), { lang: 'zh-CN', rate: 1.05, pitch: 1.1 });
      } catch (e) { /* 系统无声源：静默失效 */ }
    },
  };
```

注意：lib/voice.js 需在 content_scripts 里 renderer 之前注入——manifest 的 js 数组在 `senses/generic.js` 后、`pet/renderer.js` 前插 `lib/voice.js`（Task 2 已把 weather.js 排好位，这里同批补一行）。

- [ ] **Step 4: interaction.js 挂钩**——`showBubble` 的调用遍布 behavior/interaction；不在每处加，改在**唯一出口**：renderer.js 的 `showBubble` 里，气泡台词展示时顺带 `window.DafeiyuVoice.speak(text)`（renderer.js 的 showBubble 函数体内加一行，`bubble.textContent = text;` 之后）：

```javascript
      if (typeof window.DafeiyuVoice !== 'undefined' && text) window.DafeiyuVoice.speak(text);
```

心声（showHeart）不读——设计文档 D4 明确"仅气泡台词"。

- [ ] **Step 5: ⚙️ 面板加开关**——interaction.js 的 settingsPanel HTML 串（dy-size 行后）加：

```javascript
    '<label class="dy-row">🔊 开口说话：<input type="checkbox" class="dy-tts"></label>' +
```

监听（dy-size 监听旁）：

```javascript
  const ttsBox = settingsPanel.querySelector('.dy-tts');
  chrome.storage.local.get('tts_enabled').then(({ tts_enabled }) => { ttsBox.checked = tts_enabled === true; }).catch(() => {});
  ttsBox.addEventListener('change', async () => {
    await chrome.storage.local.set({ tts_enabled: ttsBox.checked });
    if (ttsBox.checked) V.showBubble('（清嗓）测试一下声音……主人能听见本鱼吗？');
  });
```

- [ ] **Step 6: 验证**：`node --test tests/voice.test.mjs tests/weather.test.mjs`；`node --check pet/renderer.js pet/interaction.js lib/voice.js`。
- [ ] **Step 7: Commit**：`git add lib/voice.js tests/voice.test.mjs pet/renderer.js pet/interaction.js manifest.json && git commit -m "feat(tts): DafeiyuVoice interface on chrome.tts, off by default, panel toggle"`。

---

### Task 6: 设置页——天气城市 + IP 检测 + TTS 开关

**Files:**
- Modify: `settings.html`
- Modify: `js/settings_page.js`

- [ ] **Step 1: settings.html 加区块**（在「🏠 水缸主页」之后、「🎣 代班 API」之前）：

```html
    <h2>🌤️ 天气与语音</h2>
    <p class="tip">
      填一个城市名，本鱼就能聊天气（数据来自 Open-Meteo 公共接口，只发城市名、不带任何身份信息）。
      声音用的是系统自带语音，默认关闭。
    </p>
    <div class="row"><label for="wx-city">城市</label><input id="wx-city" type="text" placeholder="上海 / 杭州 / 成都…"></div>
    <div style="display:flex;gap:8px">
      <button id="wx-detect" style="margin-top:8px;background:linear-gradient(135deg,#38bdf8,#0ea5e9);font-size:13px">📍 IP 自动检测</button>
      <button id="wx-save" style="margin-top:8px;flex:1">💾 保存城市</button>
    </div>
    <span id="wx-state"></span>
    <div class="row" style="margin-top:10px">
      <label style="display:flex;align-items:center;gap:8px">
        <input id="tts-toggle" type="checkbox" style="width:auto"> 🔊 让她开口说话（气泡台词朗读）
      </label>
    </div>
```

- [ ] **Step 2: js/settings_page.js 逻辑**（水缸主页块之后，token 自举之前——与 home 同理：不依赖信局）：

```javascript
  // ---- 天气城市 + TTS 开关（v0.9，纯 chrome.storage，信局不在也能配）----
  const $wx = (s) => document.querySelector(s);
  chrome.storage.local.get(['weather_city', 'tts_enabled']).then(({ weather_city, tts_enabled }) => {
    $wx('#wx-city').value = weather_city || '';
    $wx('#tts-toggle').checked = tts_enabled === true;
  }).catch(() => {});
  $wx('#wx-save').addEventListener('click', async () => {
    const v = $wx('#wx-city').value.trim();
    await chrome.storage.local.set({ weather_city: v });
    $wx('#wx-state').className = 'ok';
    $wx('#wx-state').textContent = v ? '已保存 ✓（约半小时内生效）' : '已清空 ✓ 天气台词将退场';
  });
  $wx('#wx-detect').addEventListener('click', async () => {
    $wx('#wx-state').className = 'testing';
    $wx('#wx-state').textContent = '正在检测…（走网络，可能几秒）';
    chrome.runtime.sendMessage({ type: 'WEATHER_IP_DETECT' }, (res) => {
      if (res && res.ok && res.city) {
        $wx('#wx-city').value = res.city;
        $wx('#wx-state').className = 'ok';
        $wx('#wx-state').textContent = `检测到 ${res.city}（代理出口城市，可能不是你在的城市）— 记得点保存`;
      } else {
        $wx('#wx-state').className = 'error';
        $wx('#wx-state').textContent = '检测失败，试试手动填～';
      }
    });
  });
  $wx('#tts-toggle').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ tts_enabled: e.target.checked });
  });
```

- [ ] **Step 3: 验证**：`node --check js/settings_page.js`；HTML 肉眼过一遍标签闭合。
- [ ] **Step 4: Commit**：`git add settings.html js/settings_page.js && git commit -m "feat(settings): weather city + IP detect + TTS toggle section"`。

---

### Task 7: 回归 + 手工冒烟清单 + README 权限说明

**Files:**
- Modify: `README.md`（权限说明增补一行）

- [ ] **Step 1: 全量回归**：`../../.venv/Scripts/python.exe -m pytest tests/ -q`（57 passed）· `node --test tests/url_sanitize.test.mjs tests/weather.test.mjs tests/voice.test.mjs`（3+5+2 passed）。
- [ ] **Step 2: README 权限说明**——「权限说明（如实相告）」末尾加：

```markdown
`tts` + 三个天气 API 域名（Open-Meteo / ipapi.co）：仅当主人在设置页填了城市后，
扩展每 30 分钟查询一次该城市的公开天气（请求只含城市名，无任何账号/设备标识）；
语音为系统自带 TTS，默认关闭。
```

- [ ] **Step 3: 手工冒烟清单（控制器执行）**：
  1. `chrome://extensions` 刷新扩展 → 0.9.0；
  2. 设置页填"上海"保存 → 等 SW 首次 wxFetch（冷启动立即跑）→ `chrome.storage.local` 里 `weather_cache` 出现 `{code, temp, city, ts}`；
  3. 新标签页/任意页面等她的气泡 → 数 20 条应出现 2-3 条天气相关（15% 配额）；
  4. ⚙️ 面板开 🔊 → 下一条气泡台词朗读（系统音）；
  5. IP 自动检测按钮 → 城市框填入（走代理可能得到代理城市——文案已提示）；
  6. 清空城市 → 天气台词退场、其余正常（零降级感验证）。

- [ ] **Step 4: Commit**：`git add README.md && git commit -m "docs: v0.9.0 weather+tts permission disclosure"`。

---

## 自检记录（Self-Review）

1. **Spec 覆盖**：D1 手填+IP（Task 6）、D2 SW 直拉+30min 缓存+域名（Task 2/3）、D3 pickQuip 15%+播报（Task 3/4）、D4 接口+chrome.tts+默认关+开关（Task 5/6）——全覆盖；"天气不进信局"（pytest 零改动）成立；雨晴播报走信局 inject 是 D3 明文设计的例外（广播链路复用，非数据同步）。
2. **占位符**：无 TBD/TODO；Task 3 Step 3 的 `lib_wmoPool` 内联副本在文中明示"两处同步"纪律注释。
3. **类型/命名一致**：`weather_city`/`weather_cache`/`weather_geo`/`tts_enabled` 四个 storage 键全程一致；`DafeiyuWeather`（lib）与 `DafeiyuSenses.weather()`（视图）职责分离与设计文档架构图一致；`WEATHER_IP_DETECT` 消息名 Task 3/6 一致；`pickFresh` 签名与 v0.8.5 现有实现一致。
4. **风险点**：chrome.tts 在部分 Windows 无中文声源（Step 已静默 catch）；Open-Meteo 断网/代理异常 → stale 标记 + 回落通用池（Task 4 pickQuip 天气分支 null 安全）。
