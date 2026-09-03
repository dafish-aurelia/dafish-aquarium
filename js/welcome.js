// 首次运行向导：任何“离开”动作都写入 onboarding_done，此后不再弹。
(async () => {
  const { onboarding_done } = await chrome.storage.local.get('onboarding_done');
  if (onboarding_done) { window.close(); return; }
  const finish = async () => {
    await chrome.storage.local.set({ onboarding_done: true });
    window.close();
  };
  document.getElementById('open-key').addEventListener('click', async () => {
    await chrome.storage.local.set({ onboarding_done: true });
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    window.close();
  });
  document.getElementById('skip-all').addEventListener('click', finish);
})();
