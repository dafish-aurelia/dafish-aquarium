(() => {
  // 鲸鱼娘信局客户端：所有网络都经 background（chrome.runtime），本文件零 fetch。
  // 注：不提供 inbox() 直排空通道 —— 信件由 background 独家消费后广播（审查四轮）。
  window.DafeiyuMailbox = {
    send: (msg) => chrome.runtime.sendMessage(msg),
    health: () => chrome.runtime.sendMessage({ type: 'MAILBOX_HEALTH' }),
    deepChat: (payload) => chrome.runtime.sendMessage({ type: 'MAILBOX_DEEP_CHAT', payload }),
    standinGet: () => chrome.runtime.sendMessage({ type: 'MAILBOX_STANDIN_GET' }),
    standinSet: (payload) => chrome.runtime.sendMessage({ type: 'MAILBOX_STANDIN_SET', payload }),
    outbox: (payload) => chrome.runtime.sendMessage({ type: 'MAILBOX_OUTBOX', payload }),
  };
})();
