import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { sanitizeUrl } = require('../lib/url_sanitize.js');

test('丢弃 query 与 fragment', () => {
  const r = sanitizeUrl('https://example.com/search?q=secret&token=abc#frag');
  assert.equal(r.url, 'https://example.com/search');
  assert.equal(r.origin, 'https://example.com');
  assert.equal(r.domain, 'example.com');
});

test('保留路径', () => {
  const r = sanitizeUrl('https://a.b/x/y?z=1');
  assert.equal(r.url, 'https://a.b/x/y');
});

test('非法输入返回空串', () => {
  const r = sanitizeUrl('not a url');
  assert.equal(r.url, '');
  assert.equal(r.domain, '');
});

test('HOME_URL 默认为空：珊瑚礁页就是默认家', () => {
  // node 上下文：无 chrome.storage，HOME_URL 保持出厂默认。
  // v0.8 解硬编码：默认空串 = 不再内置 file:///G:/... 出厂路径，
  // 珊瑚礁页（newtab.html）即家；外部水缸仅在 storage.home_url 显式配置后生效。
  assert.equal(globalThis.DafeiyuSanitize.HOME_URL, '');
  assert.equal(globalThis.DafeiyuSanitize.DEFAULT_HOME, '');
});
