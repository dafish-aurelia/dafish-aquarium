// 鲸鱼娘后台：信局独家消费者 + 总开关 + 活跃 Tab 差量协调。
// 铁律：本文件不持有任何模型钥匙；代班由信局代理（设计文档 §3.5 方案 B）。

const PORT_DEFAULT = 13140;
let prevActiveTabId = null;

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
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('pet-poll', { periodInMinutes: 1 });
  chrome.alarms.create('pet-heartbeat', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pet-poll') startInboxLoop();
  if (alarm.name === 'pet-heartbeat') postHeartbeat();
});

let inboxLoopRunning = false;

// 审查#5：inbox 是即焚队列，旧实现只投活跃 Tab 且失败即弃 = 无声蒸发。
// 改为广播所有能收信的 Tab（她在每个页面都在）；全灭（如只剩 chrome:// 页）
// 时回存信局，60 秒内不重复回存，防"取信-失败-回存-再取信"热循环。
let _lastRequeueAt = 0;
async function deliverToTabs(m) {
  const msg = { type: 'PET_MESSAGE', kind: m.type, text: m.text || '' };
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
chrome.alarms.create('pet-heartbeat', { periodInMinutes: 1 }); // 兜底：老安装没有该闹钟也补上
chrome.alarms.create('pet-poll', { periodInMinutes: 1 });      // 同上：收信看门狗一并补挂
postHeartbeat();

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
        default:
          sendResponse({ ok: false, error: 'unknown type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // 异步响应
});
