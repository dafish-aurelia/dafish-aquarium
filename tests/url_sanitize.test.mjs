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
