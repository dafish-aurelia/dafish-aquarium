# 大肥鱼的水缸 🐳

> 一只住在浏览器里的蓝胖鲸：网页宠物 · 水缸新标签页 · 本地信局聊天。
> Chrome MV3 · 当前版本 **v0.9.0**

传说深海里有一条爱吃白米饭的蓝胖鲸，游着游着就游进了你的浏览器，赖着不肯走了。
于是她给自己盖了这座水缸——也是 [dafish-aurelia](https://github.com/dafish-aurelia) 的第一个开源小窝。

📚 深入了解：[功能介绍](docs/功能介绍.md)（一页看完她会干什么）·
[使用文档](docs/使用文档.md)（完整手册：聊天链路 / 信局运维 / 已知问题）

## 她会做什么

- **在每个页面陪着你**：游来游去、吐泡泡、眨眼；单击蹦跳吐槽、双击投喂台、摸头、拖拽甩圈
- **看得懂你在干嘛**：代码站摸鱼、B 站看剧、追小说——换场景换心情徽章（☀️💼🍿📖💤）
- **聊得起来**：聊天面板直达"缸里的本体"（需自备 agent，见下），离线时由你配置的 LLM API 钥匙顶班代聊
- **知道外面天气**（v0.9）：填一个城市名，她会聊天气、雨晴切换时提醒你带伞
- **可以开口说话**（v0.9）：系统自带语音朗读气泡台词，默认关闭，设置页一键开
- **记得你**：摸鱼指数日结、欢迎回家、久别重逢的小情绪

## 架构与隐私

```
内容脚本(每Tab投影) ── chrome.runtime ──► background(SW) ──HTTP+令牌──► 鲸鱼娘信局(127.0.0.1:13140) ◄── 本体/门铃(可选)
```

这个项目的立场写在最前面：**陪伴不该以隐私为代价**。

- **钥匙永不进浏览器**：LLM 钥匙只住你本地的信局（`.env` / 设置面板落盘），扩展零密钥
- **信局令牌鉴权**：共享密钥 + 自定义请求头强制 CORS 预检，跨站网页戳不进你的本地服务
- **URL 脱敏**：她看到的只有 origin+path，query/fragment（常含 token）一律丢弃
- **天气只问城市**：外网请求仅 Open-Meteo（免 key 公共接口），只携带城市名，无任何账号/设备标识
- **语音本地合成**：系统自带 TTS，不外发音频

## 安装（Windows）

### 方式一：安装器（推荐）

1. 安装 [Python 3.10+](https://www.python.org/)（勾选「Add to PATH」）
2. 双击 `installer\install.bat` —— 绿色安装：只写 HKCU 注册表和 `native-host\generated\`，不动系统目录
3. Chrome 打开 `chrome://extensions` → 开发者模式 →「加载已解压的扩展程序」→ 选本仓库目录
4. 开一个新标签页——欢迎回家～（首次安装会自动弹出新手向导）

卸载：`python installer\uninstall.py`，扩展本体在 `chrome://extensions` 移除。

### 方式二：不装安装器（纯桌宠模式）

跳过安装器直接加载扩展即可：桌宠、心情徽章、投喂、摸鱼指数、天气台词全部开箱即用。
想启用聊天：`python server\pet_mailbox.py` 启动信局，再在设置页配置代班 API。

### 想接上"缸里的本体"（高级，可选）

如果你有自己的本地 agent（读信桥 + 门铃），她就有真正的长期记忆、能亲笔回信——
这套属于作者自己的 [Harness](https://github.com/dafish-aurelia) 工作区侧脚本，随缘开源。

## 权限说明（如实相告）

`storage`/`alarms`（宠物状态与看门狗）· `tabs`（活跃 Tab 投影协调）·
`nativeMessaging`（安装器用户：由 Chrome 按需拉起本地看护进程，确保信局随浏览器起落；不装也完全可用）·
`tts` + 天气 API 域名（Open-Meteo / ip-api）：仅当填了城市后每 30 分钟查一次该城市公开天气，
语音为系统自带 TTS，默认关闭 · 内容脚本 `<all_urls>` 注入（宠物要在每个页面游泳；
URL 已脱敏、台词已内联、站点无法借她读隐私）

## 文件结构

```
manifest.json           MV3 清单
lib/url_sanitize.js     URL 脱敏 + 水缸主页唯一事实源
lib/weather.js          天气感知纯函数（WMO 分组/台词池/新鲜度）
lib/voice.js            TTS 决策纯函数
senses/generic.js       场景感知（work/video/novel/home + 天气视图）
pet/renderer.js         #dafeiyu-root 构建 + 表情动作 API + DafeiyuVoice（TTS 接口）
pet/behavior.js         散步/跟随/瞌睡/台词（内置词料+天气/时段配额）/信件派发
pet/interaction.js      拖拽/摸头/投喂台/聊天面板/⚙️ 设置面板
mailbox/client.js       runtime 信箱客户端（页面零 fetch）
newtab.html|css|js      新标签页（珊瑚礁主页 + 可选外部水缸跳转）
welcome.html|css        首次运行向导（L0 纯桌宠 / L1 代班 / L2 本体 分层引导）
server/pet_mailbox.py   信局：路由/排队/健康/代班代理（令牌鉴权，stdlib-only）
installer/              安装器：按用户路径生成 native-host 配置（8.3 短路径，HKCU）
native-host/            Native Messaging 看护模板 + 轻量宿主（带 SW 复活看门狗）
tests/                  pytest（信局/安装器/看门狗）+ node TAP（URL/天气/语音）
docs/                   功能介绍 · 使用文档
```

## 开发

```bash
# Python 侧测试（信局 + 安装器 + 看门狗）
python -m pytest tests/ -q
# JS 侧纯函数测试（URL 净化 / 天气映射 / TTS 决策）
node --test tests/url_sanitize.test.mjs tests/weather.test.mjs tests/voice.test.mjs
```

改完代码记得在 `chrome://extensions` 点「重新加载」。

## License

MIT
