(() => {
  // 鲸鱼娘信局客户端：所有网络都经 background（chrome.runtime），本文件零 fetch。
  window.DafeiyuMailbox = {
    send: (msg) => chrome.runtime.sendMessage(msg),
    health: () => chrome.runtime.sendMessage({ type: 'MAILBOX_HEALTH' }),
    inbox: () => chrome.runtime.sendMessage({ type: 'MAILBOX_INBOX' }),
    deepChat: (payload) => chrome.runtime.sendMessage({ type: 'MAILBOX_DEEP_CHAT', payload }),
    outbox: (payload) => chrome.runtime.sendMessage({ type: 'MAILBOX_OUTBOX', payload }),
  };
})();
