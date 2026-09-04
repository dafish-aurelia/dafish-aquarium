import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
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
  // 99 = thunderstorm with heavy hail，属 storm codes [95, 96, 99]
  assert.equal(W.wmoToPool(99), 'storm');
  assert.equal(W.wmoToPool(45), 'fog');
  // unknown = 不属于任何分组的代码（如 4、5）、NaN、缺失
  assert.equal(W.wmoToPool(4), 'unknown');
  assert.equal(W.wmoToPool(NaN), 'unknown');
});

test('WEATHER_QUIPS 每个池至少 3 条台词', () => {
  for (const p of ['clear', 'cloud', 'rain', 'snow', 'storm', 'fog', 'unknown']) {
    assert.ok(Array.isArray(W.WEATHER_QUIPS[p]), `pool ${p} 应为数组`);
    assert.ok(W.WEATHER_QUIPS[p].length >= 3, `pool ${p} 至少 3 条`);
  }
  assert.ok(Array.isArray(W.ADVISORY_QUIPS.umbrella));
  assert.ok(Array.isArray(W.ADVISORY_QUIPS.hot));
  assert.ok(Array.isArray(W.ADVISORY_QUIPS.cold));
});

test('提醒池选择：降水概率与极端气温', () => {
  assert.equal(W.advisoryPool({ precip: 70, temp: 25 }), W.ADVISORY_QUIPS.umbrella);
  assert.equal(W.advisoryPool({ precip: 20, temp: 25 }), null);
  assert.equal(W.advisoryPool({ precip: 10, temp: 36 }), W.ADVISORY_QUIPS.hot);
  assert.equal(W.advisoryPool({ precip: 10, temp: -2 }), W.ADVISORY_QUIPS.cold);
  assert.equal(W.advisoryPool({ precip: 10, temp: 25 }), null);
  assert.equal(W.advisoryPool(null), null);
});

test('isFresh：30 分钟缓存新鲜窗口', () => {
  const now = Date.now();
  assert.equal(W.isFresh({ ts: now - 29 * 60 * 1000 }), true);
  assert.equal(W.isFresh({ ts: now - 31 * 60 * 1000 }), false);
  assert.equal(W.isFresh(null), false);
  assert.equal(W.isFresh(undefined), false);
});

test('parseGeocode：open-meteo geocoding 响应解析', () => {
  const body = { results: [{ latitude: 31.2, longitude: 121.5 }] };
  assert.deepEqual(W.parseGeocode(body), { latitude: 31.2, longitude: 121.5 });
  assert.equal(W.parseGeocode({ results: [] }), null);
  assert.equal(W.parseGeocode({}), null);
});
