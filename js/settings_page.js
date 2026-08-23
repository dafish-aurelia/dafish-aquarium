// 代班小鱼安全配置页：住在 chrome-extension:// 独立源，
// 宿主网页的脚本永远读不到这里的输入框（对抗审查五轮的修复载体）。
(async function () {
  const MAILBOX = 'http://127.0.0.1:13140';
  const $ = (sel) => document.querySelector(sel);
  const state = $('#state');

  // 令牌自举：Host 钉扎端点，扩展页经 host_permissions 可直连
  async function token() {
    const r = await fetch(MAILBOX + '/api/token');
    return (await r.json()).token || '';
  }
  async function req(path, payload) {
    const res = await fetch(MAILBOX + path, {
      method: payload ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Dafeiyu-Token': TOK },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return res.json();
  }

  let TOK = '';
  try {
    TOK = await token();
    const cfg = await req('/api/standin_config');
    $('#u').value = cfg.baseUrl || '';
    $('#m').value = cfg.model || '';
    state.textContent = cfg.hasKey
      ? `当前已配置钥匙（尾号 ${cfg.keyTail}）`
      : '尚未配置钥匙 —— 不配置的话，代班只会说占位话哦';
  } catch (e) {
    state.textContent = '信局不在家（127.0.0.1:13140），请先启动信局再配置';
    $('#save').disabled = true;
    return;
  }

  $('#save').addEventListener('click', async () => {
    const payload = {
      baseUrl: $('#u').value.trim(),
      model: $('#m').value.trim(),
    };
    const key = $('#k').value.trim();
    if (key) payload.apiKey = key; // 留空 = 不改动已存钥匙
    if (!payload.baseUrl && !payload.model && !payload.apiKey) {
      state.textContent = '什么都没填，本鱼就当你只是来看看。';
      return;
    }
    state.textContent = '保存中…';
    try {
      const res = await req('/api/standin_config', payload);
      if (res && res.ok) {
        state.className = 'ok';
        state.textContent = res.hasKey
          ? `已保存 ✓ 代班小鱼领到钥匙了（尾号 ${res.keyTail}）`
          : '已保存 ✓（未填钥匙：她仍会说占位话）';
        $('#k').value = '';
      } else {
        state.textContent = '保存失败，稍后再试。';
        state.className = '';
      }
    } catch (e) {
      state.textContent = '保存失败：' + e;
    }
  });
})();
