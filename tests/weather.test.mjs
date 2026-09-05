import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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

// ---- WMO 副本同步哨兵 ----
// background.js 有 _WMO_POOLS 内联副本（SW 不能 require 内容脚本库，双份是刻意设计），
// 两份各自漂移 = 雨晴切换播报与内容脚本台词池对不上号。本测试读两份源码、
// 提取数组字面量做结构化比对：任何一侧改了分组，这里立刻红。
// （字面量是单引号键值 + 多行数组，非合法 JSON，且 background.js 是 CRLF——
//   所以用"标记切一刀 + eval"提取，别用 \n 正则。）
function extractPoolLiteral(source, varName) {
  const start = source.indexOf('const ' + varName + ' = [');
  assert.ok(start >= 0, `源码中找不到 const ${varName} = [（改了变量名？请同步本测试）`);
  const end = source.indexOf('];', start);
  assert.ok(end > start, `找不到 ${varName} 数组的收尾 ];`);
  const literal = source.slice(start + ('const ' + varName + ' = ').length, end + 1);
  let parsed;
  try { parsed = eval('(' + literal + ')'); }
  catch (e) { assert.fail(`${varName} 字面量解析失败：${e.message}`); }
  assert.ok(Array.isArray(parsed) && parsed.length > 0, `${varName} 应为非空数组`);
  const norm = {};
  for (const g of parsed) {
    assert.ok(g.pool && Array.isArray(g.codes) && g.codes.length, '每个分组需有 pool 与非空 codes');
    norm[g.pool] = [...g.codes].sort((a, b) => a - b).join(',');
  }
  return norm;
}

test('WMO 副本同步：background.js 内联 _WMO_POOLS 与 lib/weather.js 正本一致', () => {
  const bg = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../lib/weather.js', import.meta.url), 'utf8');
  const bgPools = extractPoolLiteral(bg, '_WMO_POOLS');
  const libPools = extractPoolLiteral(lib, 'WMO_POOLS');
  // 结构化比对（排序后的 pool→codes 映射），分组顺序无关、行尾风格无关
  assert.deepEqual(bgPools, libPools);
  // 双保险：lib 源码字面量与实际导出对象一致（防导出与源码脱钩）
  const exported = {};
  for (const g of W.WMO_POOLS) exported[g.pool] = [...g.codes].sort((a, b) => a - b).join(',');
  assert.deepEqual(libPools, exported);
});
