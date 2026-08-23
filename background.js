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
chrome.windows.onFocusChanged.addListener(() => syncActiveTab());
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
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pet-poll') startInboxLoop();
});

let inboxLoopRunning = false;
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
        const base = await mailboxBase();
        const r = await fetch(base + '/api/inbox?wait=25'); // 长轮询：挂起等信，最长25秒
        const data = await r.json();
        for (const m of data.messages || []) {
          chrome.tabs.sendMessage(prevActiveTabId, {
            type: 'PET_MESSAGE',
            kind: m.type,
            text: m.text || '',
          }).catch(() => {});
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

async function mailboxBase() {
  const { mailboxPort } = await chrome.storage.local.get('mailboxPort');
  return `http://127.0.0.1:${mailboxPort || PORT_DEFAULT}`;
}

async function mbJson(path, opts) {
  const base = await mailboxBase();
  const r = await fetch(base + path, opts);
  return r.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'PET_QUERY_STATE': {
          // 内容脚本冷启动竞态的拉取兜底：直接回答"你是否是活跃投影"
          const { enabled = true } = await chrome.storage.local.get('enabled');
          sendResponse({ active: !!sender.tab && sender.tab.id === prevActiveTabId, enabled });
          break;
        }
        case 'MAILBOX_HEALTH': {
          try { sendResponse({ ok: (await mbJson('/health')).ok === true }); }
          catch (e) { sendResponse({ ok: false }); }
          break;
        }
        case 'MAILBOX_INBOX': {
          try { sendResponse(await mbJson('/api/inbox')); }
          catch (e) { sendResponse({ ok: false, messages: [] }); }
          break;
        }
        case 'MAILBOX_DEEP_CHAT': {
          try {
            sendResponse(await mbJson('/api/deep_chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg.payload),
            }));
          } catch (e) { sendResponse({ ok: false }); }
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
