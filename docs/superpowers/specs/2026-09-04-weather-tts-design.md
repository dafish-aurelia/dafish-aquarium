# 天气感知 + 场景语音 + TTS 接口 · 设计文档

> 2026-09-04 · brainstorming 产物 · 目标版本 v0.9.0
> 状态：待主人审阅

## 背景与目标

大肥鱼的离线语录目前只感知"网页场景"（work/video/novel）和"时段"。主人提出补上**真实世界的感知**：天气 + 所在城市，让台词有"外面在下雨，本鱼帮你盯着窗户"这种活气；同时给宠物一个 **TTS 说话接口**，本期先用系统自带语音，留好以后换音源的口子。

三个能力一句话：

1. **天气感知**：城市 → Open-Meteo（免 key 公共 API）→ 当前温度/天气代码/今日降水概率，缓存 30 分钟；
2. **定位**：默认主人手填城市名（设置页），可选"IP 自动检测"按钮作辅助；**不用**浏览器 geolocation；
3. **TTS**：`DafeiyuVoice.speak(text)` 接口落进渲染层，本期实现接 `chrome.tts`（系统音），默认关、设置页开。

## 关键决策与理由（brainstorming 定稿）

### D1 定位：手填城市为主，IP 自动检测为辅（不用 geolocation）

- **为什么**：浏览器 geolocation 要新增权限 + Chrome 弹"允许此扩展了解你的位置"，对分发场景是隐私惊吓；而天气台词只需要城市级精度。主人机器走代理（127.0.0.1:7890），IP 检测出来的城市还可能是代理出口城市，所以手填为主、IP 为辅。
- IP 检测用免 key 的 `https://ipapi.co/json/`（经 SW fetch，走系统代理）。失败静默，不挡任何流程。
- 城市名存 `chrome.storage.local.weather_city`（如"上海"）。天气 API 的地理编码端点把城市名换算成经纬度（`geocoding-api.open-meteo.com`，中文地名直接支持）。

### D2 天气走 background SW 直拉（不经信局）

- **为什么**：Level 0（不装信局）用户也该有天气——天气是离线陪伴感的一部分，不该依赖信局在岗。manifest `host_permissions` 增加两个域名：`https://api.open-meteo.com/*`、`https://geocoding-api.open-meteo.com/*`、`https://ipapi.co/*`。
- SW 每 30 分钟拉一次（复用现有 alarm 模式，新增 `pet-weather` alarm），结果写 `chrome.storage.local.weather_cache`（带 ts）。内容脚本经 storage.onChanged 即时感知——与现有 home_url 推送模式同构。
- **隐私边界**：外发请求只带城市名/经纬度给天气 API，query 无任何用户标识；README 权限说明如实增补。信局/Harness 完全不参与（本期不做"天气同步给信局"——YAGNI，以后真想要再加）。

### D3 天气台词：挂在现有 pickQuip 体系，不新建触发器

复用 v0.8.5 的 `pickFresh` 反重复与概率混入架构，`pickQuip` 分布调整为：45% 场景 / 20% 时段 / **15% 天气** / 20% 通用兜底。天气池按 WMO code 分组（晴/多云/雨/雪/雷/雾·霾），每组 4-6 条；降水概率 ≥60% 加播"带伞"线；气温 ≥34℃ 或 ≤0℃ 有极端提醒池。**天气未知（未配城市/拉取失败）时，15% 配额自动回落到通用池**——离线零降级感。

另有"天气显著变化"一次性播报：SW 拉到新天气与缓存对比，雨↔晴切换时经现有 inbox→PET_MESSAGE 广播链路推一句（走信局 inject，信局不在就跳过——不新增旁路）。

### D4 TTS：接口在渲染层，实现先 chrome.tts，默认关

- 接口：`window.DafeiyuVoice = { speak(text, opts), enabled() }` 落在 pet/renderer.js（与 DafeiyuView 同层，全部行为脚本可用）。
- 实现体：`chrome.tts.speak`（Chrome 自带中文语音，`tts` 权限需加入 manifest）。**默认关闭**，设置面板（pet 侧 ⚙️）加开关 + `chrome.storage.local.tts_enabled`；开关开着时 `showBubble` 的台词同步朗读（仅气泡台词，心声/弹幕反应不读——避免吵）。
- **换音源的口子**：`DafeiyuVoice.speak` 内部先查 `tts_provider`（storage，本期恒为 `'chrome'`）；以后接网络音源（如商汤/硅基流动的 speech 端点）只改这个函数体，接口与触发点全都不动。

## 架构与数据流

```
设置页(settings.html) ──城市名──► chrome.storage.weather_city
                                        │ storage.onChanged
background.js ◄─── pet-weather alarm(30min) ───┐
  │ geocoding(城市名→经纬度, 缓存1天)           │
  │ api.open-meteo.com(经纬度→天气, 缓存30min)  │
  ▼                                            │
chrome.storage.weather_cache ──onChanged──► senses/generic.js
  （暴露 DafeiyuSenses.weather()：{code,temp,precip,city,ts}）
                                        │
pet/behavior.js pickQuip ──15%──► WEATHER_QUIPS[WMO分组] 池
  │（雨↔晴切换时 SW→信局 inject→inbox 广播，现有链路）
  ▼
showBubble(台词) ──DafeiyuVoice.speak──► chrome.tts（默认关）
```

## 组件与文件

| 文件 | 职责 | 改动 |
|---|---|---|
| `manifest.json` | 权限 | +`tts`；host_permissions +3 个 API 域名 |
| `background.js` | 天气拉取与缓存、变化播报、IP 检测消息处理 | +`pet-weather` alarm、`WEATHER_*` 消息类型 |
| `senses/generic.js` | 天气只读视图 | +`weather()` 读 storage 缓存（不自己发请求） |
| `pet/behavior.js` | 天气台词池 + pickQuip 概率重分配 | +WEATHER_QUIPS、UMBRELLA/EXTREME 池 |
| `pet/renderer.js` | TTS 接口落点 | +`DafeiyuVoice`（speak/enabled） |
| `pet/interaction.js` | 气泡朗读挂钩 + 设置面板开关 | showBubble 路径可选朗读 |
| `settings.html`/`js/settings_page.js` | 城市配置 + IP 检测按钮 + TTS 开关 | 新"🌤️ 天气与语音"区块 |

## 错误处理（全部静默降级，天气永不报错打扰）

- 城市未配置 → `weather()` 返回 null → 天气配额回落通用池；设置页显示"填个城市，本鱼就能聊天气"。
- geocoding 查不到城市（错别字）→ 设置页即时红字提示"这座城市本鱼找不到"；天气配额回落。
- 天气拉取失败（断网/代理挂）→ 用旧缓存（带 ts 标注"旧数据"）；超过 6 小时的缓存视为过期回落通用池。
- TTS 不可用（系统无声源）→ speak 内部 catch，功能静默失效，开关状态照存。
- IP 检测失败 → 按钮变"检测失败，试试手动填"。

## 测试策略

- **可单测**（node --test，模式同 url_sanitize.test.mjs）：
  - WMO code → 池名映射函数（晴/雨/雪/雷/雾分组表）
  - 降水概率/气温 → 提醒池选择逻辑（纯函数）
  - `DafeiyuVoice` 的 provider 分支（mock chrome.tts）
- **不可单测但人工验收**：设置页城市保存→重载扩展→30 分钟内出现天气台词；雨晴切换播报一次；TTS 开关开→气泡朗读。
- pytest 信局侧零改动（天气不进信局，D2 决策）。

## 明确不做（YAGNI）

- 浏览器 geolocation 精确定位
- 天气数据同步给信局/本鱼回信引用（后补候选）
- 网络 TTS 音源接入（接口已留，provider='chrome'）
- 基于位置的更多服务（日出日落提醒等，先观察台词效果）
