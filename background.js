// 鲸鱼娘后台：信局独家消费者 + 总开关 + 活跃 Tab 差量协调。
// 铁律：本文件不持有任何模型钥匙；代班由信局代理（设计文档 §3.5 方案 B）。

const PORT_DEFAULT = 13140;
let prevActiveTabId = null;

// ---- v0.9 天气感知 ----
const WX_GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const WX_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const WX_IPAPI = 'https://ipapi.co/json/';
// WMO 分组内联副本（lib/weather.js 有正本，改一处必须同步另一处）
const _WMO_POOLS = [
  { pool: 'clear', codes: [0, 1] },
  { pool: 'cloud', codes: [2, 3] },
  { pool: 'fog', codes: [45, 48] },
  { pool: 'rain', codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82] },
  { pool: 'snow', codes: [71, 73, 75, 77, 85, 86] },
  { pool: 'storm', codes: [95, 96, 99] },
];
function _wmoPool(code) {
  if (typeof code !== 'number' || Number.isNaN(code)) return 'unknown';
  for (const g of _WMO_POOLS) if (g.codes.includes(code)) return g.pool;
  return 'unknown';
}
function _wxParseGeocode(body) {
  const r = body && body.results && body.results[0];
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  return { lat: r.latitude, lon: r.longitude };
}
const WX_FRESH_MS = 30 * 60e3;
function _wxIsFresh(c) { return !!(c && typeof c.ts === 'number' && Date.now() - c.ts < WX_FRESH_MS); }

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// 差量通知：只有"上一个活跃 Tab（隐藏）"和"新活跃 Tab（显示）"收到消息
async function syncActiveTab() {
  const tab = await getActiveTab();
  const newId = tab ? tab.id : null;
  if (newId !== prevActiveTabId) {
    if (prevActiveTabId != null) {
      chrome.tabs.sendMessage(prevActiveTabId, { type: 'PET_ACTIVE', visible: false }).catch(() => {});
    }
    if (newId != null) {
      chrome.tabs.sendMessage(newId, { type: 'PET_ACTIVE', visible: true }).catch(() => {});
    }
    prevActiveTabId = newId;
  }
}

chrome.windows.getLastFocused().then((w) => syncActiveTab());
// 焦点语义（0.5.7）：只在"多个 Chrome 窗口之间切换"时搬投影；
// 焦点整体离开浏览器（WINDOW_ID_NONE，比如主人去写代码）时她留守原地——
// 陪跑宠物不该因为主人切走就消失，否则所有定时行为（看剧礼仪/搭话）全灭。
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  syncActiveTab();
});
chrome.tabs.onActivated.addListener(() => syncActiveTab());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === prevActiveTabId && info.status === 'complete') syncActiveTab();
});

// v0.6 短期浏览记忆：域名级访问流水（仅本地 storage，24h TTL，上限 40 条）。
// 只记 hostname，不落路径/query——陪伴台词引用"又游回某站啦"用，绝不上传。
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t.url || !/^https?:/.test(t.url)) return;
    const dom = new URL(t.url).hostname;
    const { browse_log = [] } = await chrome.storage.local.get('browse_log');
    const now = Date.now();
    const fresh = browse_log.filter((e) => now - e.t < 24 * 3600e3);
    fresh.push({ d: dom, t: now });
    await chrome.storage.local.set({ browse_log: fresh.slice(-40) });
  } catch (e) { /* tab 可能已关闭 */ }
});

// 总开关：图标点击切换 enabled；关闭时徽标提示并让所有投影退场
chrome.action.onClicked.addListener(async () => {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  const next = !enabled;
  await chrome.storage.local.set({ enabled: next });
  chrome.action.setBadgeText({ text: next ? '' : '休' });
  if (!next) {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id == null) continue;
      chrome.tabs.sendMessage(t.id, { type: 'PET_ACTIVE', visible: false }).catch(() => {});
    }
    prevActiveTabId = null;
  } else {
    await syncActiveTab();
  }
});

// 独家收信：长轮询循环（信到秒推）。alarm 仅作看门狗，循环死了就拉起来。
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('pet-poll', { periodInMinutes: 1 });
  chrome.alarms.create('pet-heartbeat', { periodInMinutes: 1 });
  // v0.8 首装向导：只在全新安装时弹一次；更新/重载不打扰
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});
// v0.8.3 冷启动保险：Chrome 152 对 unpacked 扩展实测——浏览器重启后
// alarm 投递失效、tabs 事件不唤醒 SW（心跳断流两整天事故）。onStartup 是
// 唯一保证在浏览器启动时投递的事件，收到即跑一次完整自检。
chrome.runtime.onStartup.addListener(() => {
  try {
    startInboxLoop();
    postHeartbeat();
    connectGatekeeper();
  } catch (e) { console.error('[startup] 自检失败:', e); }
});

// v0.7 摸鱼指数：活跃 Tab 场景分类（与 senses 同一套正则的 SW 侧副本）
const SCENE_WORK = /(^|\.)github\.com$|(^|\.)stackoverflow\.com$|(^|\.)gitee\.com$|(^|\.)juejin\.cn$|(^|\.)csdn\.net$/;
const SCENE_VIDEO = /(^|\.)bilibili\.com$|(^|\.)youtube\.com$|(^|\.)iqiyi\.com$|(^|\.)youku\.com$|(^|\.)netflix\.com$/;
const SCENE_NOVEL = /(^|\.)qidian\.com$|(^|\.)jjwxc\.net$|(^|\.)69shu(?:ba)?\.(com|net)$|(^|\.)sfacg\.com$|(^|\.)ciweimao\.com$|(^|\.)zongheng\.com$/;
function classifyHost(h) {
  if (!h) return 'chill';
  if (SCENE_WORK.test(h)) return 'work';
  if (SCENE_VIDEO.test(h)) return 'video';
  if (SCENE_NOVEL.test(h)) return 'novel';
  return 'chill';
}
async function accumulateMood() {
  try {
    const tab = await getActiveTab();
    const scene = classifyHost(tab && new URL(tab.url || 'http://x/').hostname);
    const today = new Date().toISOString().slice(0, 10);
    const { mood_today = {}, mood_date = today } = await chrome.storage.local.get(['mood_today', 'mood_date']);
    const m = mood_date === today ? mood_today : {};
    m[scene] = (m[scene] || 0) + 60;
    await chrome.storage.local.set({ mood_today: m, mood_date: today });
  } catch (e) { /* 无活跃窗口等 */ }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pet-poll') startInboxLoop();
  if (alarm.name === 'pet-heartbeat') postHeartbeat();
  if (alarm.name === 'pet-mood') accumulateMood();
  if (alarm.name === 'pet-gate') { try { connectGatekeeper(); } catch (e) { console.error('[gate]', e); } }
  if (alarm.name === 'pet-weather') { wxFetch().catch(() => {}); }
});

let inboxLoopRunning = false;

// 审查#5：inbox 是即焚队列，旧实现只投活跃 Tab 且失败即弃 = 无声蒸发。
// 改为广播所有能收信的 Tab（她在每个页面都在）；全灭（如只剩 chrome:// 页）
// 时回存信局，60 秒内不重复回存，防"取信-失败-回存-再取信"热循环。
let _lastRequeueAt = 0;
async function deliverToTabs(m) {
  const msg = { type: 'PET_MESSAGE', kind: m.type, text: m.text || '' };
  if (m.from !== undefined) msg.from = m.from; // v0.9 weather_shift：池名透传给切换播报
  if (m.to !== undefined) msg.to = m.to;
  const tabs = await chrome.tabs.query({});
  let delivered = 0;
  for (const t of tabs) {
    if (t.id == null) continue;
    try {
      await chrome.tabs.sendMessage(t.id, msg);
      delivered++;
    } catch (e) { /* 该 Tab 没有内容脚本，正常 */ }
  }
  if (delivered === 0 && Date.now() - _lastRequeueAt > 60000) {
    _lastRequeueAt = Date.now();
    try {
      await mbJson('/api/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m),
      });
    } catch (e) { /* 回存也失败：这封信只能放弃 */ }
  }
}

async function inboxLoop() {
  if (inboxLoopRunning) return;
  inboxLoopRunning = true;
  try {
    while (true) {
      const { enabled = true } = await chrome.storage.local.get('enabled');
      if (!enabled || prevActiveTabId == null) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      try {
        const r = await mbFetch('/api/inbox?wait=25'); // 长轮询：挂起等信，最长25秒
        const data = await r.json();
        for (const m of data.messages || []) {
          await deliverToTabs(m);
        }
      } catch (e) {
        await new Promise((r) => setTimeout(r, 5000)); // 信局不在家：低频重试
      }
    }
  } finally {
    inboxLoopRunning = false;
  }
}

// 看门狗统一入口：冷启动与 alarm 都从这里拉起长轮询循环（inboxLoop 自带重入保护）
function startInboxLoop() { inboxLoop(); }

startInboxLoop();

// 投影心跳：告诉信局"浏览器这端的投影活着"。注意：这不等于"本鱼在线"——
// deep_chat 路由只认 /api/fish_heartbeat（读信桥/本体当值时才发）。
// 总开关关闭时不再续命，TTL 一到投影自然判离线。
async function postHeartbeat() {
  try {
    const { enabled = true } = await chrome.storage.local.get('enabled');
    if (!enabled) return;
    const res = await mbJson('/api/heartbeat', { method: 'POST' });
    // 自迭代通道（主人授权）：信局转达刷新指令 → 立即重载扩展，
    // 让新版本内容脚本无需主人手动去 chrome://extensions 点按钮。
    if (res && res.devReload) {
      // Tell all tabs to refresh so new content scripts get injected after reload
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id == null || t.url?.startsWith('chrome://')) continue;
          chrome.tabs.sendMessage(t.id, { type: 'DEV_REFRESH_PAGE' }).catch(() => {});
        }
      } catch (e) { /* best effort */ }
      // Small delay to let the message reach tabs before SW dies
      await new Promise(r => setTimeout(r, 500));
      chrome.runtime.reload();
    }
  } catch (e) { /* 信局不在家：静默，等下个 alarm 再试 */ }
}

// ---- v0.9 天气拉取管线（拉取只在 SW，视图层只读 storage 缓存）----

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

// 经纬度 → 天气快照 { code, temp, precip, city, ts, stale }；失败用旧缓存并标 stale
async function wxFetch() {
  const { weather_city = '' } = await chrome.storage.local.get('weather_city');
  if (!weather_city) return;
  const { weather_cache: old } = await chrome.storage.local.get('weather_cache');
  const geo = await wxResolveCity(weather_city);
  if (!geo) {
    if (old) chrome.storage.local.set({ weather_cache: { ...old, stale: true } });
    return;
  }
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
    // 雨晴切换播报：上一份缓存已过期（跨两轮拉取）且池名翻转（雨↔非雨）时，
    // 经信局 inject 广播一帧 weather_shift——她说什么由 behavior 层现场生成
    if (old && !_wxIsFresh(old) && typeof old.code === 'number' && old.code !== wx.code) {
      const aPool = _wmoPool(old.code), bPool = _wmoPool(wx.code);
      if ((aPool === 'rain') !== (bPool === 'rain')) {
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

chrome.alarms.create('pet-heartbeat', { periodInMinutes: 1 }); // 兜底：老安装没有该闹钟也补上
chrome.alarms.create('pet-poll', { periodInMinutes: 1 });      // 同上：收信看门狗一并补挂
chrome.alarms.create('pet-mood', { periodInMinutes: 1 });      // v0.7 摸鱼指数累积
chrome.alarms.create('pet-gate', { periodInMinutes: 0.5 });    // v0.7.2 门卫断线看门狗
chrome.alarms.create('pet-weather', { periodInMinutes: 30 });  // v0.9 天气缓存
accumulateMood();
postHeartbeat();
wxFetch().catch(() => {}); // v0.9 冷启动别等 30 分钟
// ---- v0.7.2 门卫（Native Messaging 寄生）----
// 后勤看护住在 Chrome 里：SW 冷启动即 connectNative 拉起看护进程，
// 看护负责确保信局+门铃在岗。SW 活跃期间（inboxLoop 长轮询）连接保持；
// Chrome 关闭/SW 意外休眠 → 看护 stdin EOF → 它自己启动"5分钟宽限遗嘱"
// 决定是否送服务下班。pet-gate alarm 只作断线重连看门狗。
var _gatePort = null; // var 而非 let：alarm 回调可能在顶层执行完成前触发，let 的 TDZ 会把 SW 炸死
function connectGatekeeper() {
  if (_gatePort) return; // 已连接
  try {
    const port = chrome.runtime.connectNative('dafeiyu_gatekeeper');
    _gatePort = port;
    port.onMessage.addListener((m) => {
      if (m && m.type === 'pong') console.log('[gate] 看护应答:', JSON.stringify(m));
      // v0.8.1 复活帧：看护发现投影心跳超时（SW 死后 alarm 投递失效的现实事故）。
      // native port 入站消息是强制事件源——收到即证明本 SW 刚被拉起或仍活着，
      // 趁清醒把心跳、收信、看护连接一次性续上。
      if (m && m.type === 'revive') {
        console.log('[gate] 复活帧到达:', JSON.stringify(m));
        try {
          startInboxLoop();
          postHeartbeat();
          if (!_gatePort) connectGatekeeper();
        } catch (e) { console.error('[gate] 复活动作失败:', e); }
      }
    });
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      console.log('[gate] 看护断开', err ? String(err.message || err) : '');
      _gatePort = null; // pet-gate alarm 会负责重连
    });
    port.postMessage({ type: 'pulse', ts: Date.now() });
  } catch (e) { console.error('[gate] connectNative 失败:', e); }
}
// v0.8.3 顶层直连看护：原先只挂在 pet-gate alarm（30s 后才连），而闹钟在
// 死 SW 身上不响——顶层这一句才是"冷启动即拉起看护"的真正兑现。
connectGatekeeper();

// 信局地址钉死（审查#11：mailboxPort 全工程无写入方，属幽灵配置，删除读取分支）
function mailboxBase() {
  return `http://127.0.0.1:${PORT_DEFAULT}`;
}

// 共享密钥（审查#6）：经 Host 钉扎的 /api/token 引导获取，此后每个请求都带上；
// 遇 401 清缓存重新引导一次，防止钥匙轮换后永久毒化。
let _tokenPromise = null;
async function authToken() {
  if (!_tokenPromise) {
    _tokenPromise = fetch(mailboxBase() + '/api/token')
      .then((r) => r.json())
      .then((j) => j.token || '')
      .catch(() => '');
  }
  return _tokenPromise;
}

async function mbFetch(path, opts = {}) {
  const token = await authToken();
  const headers = Object.assign({}, opts.headers || {}, token ? { 'X-Dafeiyu-Token': token } : {});
  const res = await fetch(mailboxBase() + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) invalidateToken();
  return res;
}
function invalidateToken() { _tokenPromise = null; }

async function mbJson(path, opts) {
  const r = await mbFetch(path, opts);
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'PET_QUERY_STATE': {
          // 拉取兜底：实时计算活跃 Tab，而非读 SW 重启即失忆的 prevActiveTabId
          // 缓存 —— 否则 SW 冷启动后所有页面会隐身到下一次 Tab 事件才复活。
          const [{ enabled = true }, tab] = await Promise.all([
            chrome.storage.local.get('enabled'),
            getActiveTab(),
          ]);
          const active = !!sender.tab && !!tab && sender.tab.id === tab.id;
          if (active && sender.tab.id !== prevActiveTabId) {
            prevActiveTabId = sender.tab.id; // 顺手自愈缓存游标
          }
          sendResponse({ active, enabled });
          break;
        }
        case 'MAILBOX_HEALTH': {
          try { sendResponse({ ok: (await mbJson('/health')).ok === true }); }
          catch (e) { sendResponse({ ok: false }); }
          break;
        }
        // （审查四轮）MAILBOX_INBOX 直排空通道已删：语义危险（绕过广播即焚信件）
        case 'MAILBOX_DEEP_CHAT': {
          // 审查二轮#4：给前端分类错误原因（锁门/断链），不再共用一句"出游"
          try {
            const res = await mbFetch('/api/deep_chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg.payload),
            });
            if (res.status === 401) {
              invalidateToken();
              sendResponse({ ok: false, reason: 'auth' });
              break;
            }
            sendResponse(await res.json());
          } catch (e) { sendResponse({ ok: false, reason: 'offline' }); }
          break;
        }
        case 'OPEN_URL': {
          // 漂流瓶等场景：代开 https 页面（内容脚本无 tabs 特权）
          const u = String(msg.url || '');
          if (/^https:\/\//.test(u)) chrome.tabs.create({ url: u });
          sendResponse({ ok: true });
          break;
        }
        case 'OPEN_HOME': {
          // 内容脚本无 tabs 特权，代为开水缸主页（URL 来自扩展自身消息）
          // v0.8：默认家 = 珊瑚礁页（newtab），显式配了 storage.home_url 才跳外部水缸；
          // 除 file/http(s) 外也放行本扩展自有的 newtab 页（等同跳板）。
          const u = String(msg.url || '');
          if (/^(file|https?):/.test(u) || u === chrome.runtime.getURL('newtab.html')) {
            chrome.tabs.create({ url: u });
          }
          sendResponse({ ok: true });
          break;
        }
        case 'OPEN_STANDIN_SETTINGS': {
          // 审查五轮：钥匙表单住在扩展自有页面（独立源），宿主页脚本读不到
          chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
          sendResponse({ ok: true });
          break;
        }
        case 'HARNESS_MODELS': {
          try {
            const res = await mbJson('/api/harness_models', { method: 'POST' });
            sendResponse(res);
          } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          break;
        }
        case 'HARNESS_SELECT_MODEL': {
          try {
            const res = await mbJson('/api/harness_select_model', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg.payload),
            });
            sendResponse(res);
          } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          break;
        }
        case 'STANDIN_TEST_MODELS': {
          try {
            const res = await mbJson('/api/standin_test_models', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg.payload),
            });
            sendResponse(res);
          } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          break;
        }
        case 'MAILBOX_OUTBOX': {
          try {
            sendResponse(await mbJson('/api/outbox', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg.payload),
            }));
          } catch (e) { sendResponse({ ok: false }); }
          break;
        }
        case 'WEATHER_IP_DETECT': {
          // settings 页"猜城市"按钮：SW 代拉 ipapi（页面侧无 host 权限）
          try {
            const r = await fetch(WX_IPAPI);
            const d = await r.json();
            sendResponse({ ok: true, city: d.city || '', ip: d.ip || '' });
          } catch (e) { sendResponse({ ok: false }); }
          break;
        }
        case 'TTS_SPEAK': {
          // v0.9 TTS 中继：chrome.tts 不在内容脚本 API 白名单，由 SW 代为发声。
          // 调用方（renderer showBubble）已过 enabled+active 双门控，这里不重复判断。
          try {
            chrome.tts.speak(String(msg.text || ''), { lang: 'zh-CN', rate: 1.05, pitch: 1.1 });
          } catch (e) { /* 系统无声源：静默失效 */ }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // 异步响应
});
