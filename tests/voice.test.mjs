import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const voice = require('../lib/voice.js');

test('speak 决策：开关关闭时静默', () => {
  assert.equal(voice.shouldSpeak({ enabled: false }, 'chrome'), false);
  assert.equal(voice.shouldSpeak({ enabled: true }, 'chrome'), true);
  assert.equal(voice.shouldSpeak({}, 'chrome'), false); // 未配置默认关
});

test('speak 决策：未知 provider 静默（未来音源未接入时不炸）', () => {
  assert.equal(voice.shouldSpeak({ enabled: true }, 'siliconflow-tts'), false);
});
