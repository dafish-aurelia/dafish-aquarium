# 大肥鱼的水缸 🐳

> 一只住在浏览器里的蓝胖鲸：网页宠物 + 水缸新标签页 + 本地信局聊天。Chrome MV3。
> 当前版本 **v0.8.3**（重启存活手术：清除旧 ID 冲突记录 + onStartup 冷启动保险 + 顶层看护直连）。
>
> 🐳 新朋友看这里：[docs/功能介绍.md](docs/功能介绍.md) —— 她都会干什么，一页看完
> 📘 完整的使用与测试文档（聊天链路 / 信局运维 / 已知问题清单）见 [docs/使用文档.md](docs/使用文档.md)。

## 故事

传说深海里有一条爱吃白米饭的蓝胖鲸，游着游着就游进了你的浏览器，赖着不肯走了。
于是它给自己盖了这座水缸——也是 GitHub 账号 [dafish-aurelia](https://github.com/dafish-aurelia) 的第一个开源小窝。

## 架构与安全

```
内容脚本(每Tab投影) ── chrome.runtime ──► background(SW) ──HTTP+令牌──► 鲸鱼娘信局(127.0.0.1:13140) ◄── 读信桥/门铃(Harness 侧)
```

- **钥匙永不进浏览器**：LLM 钥匙只住工作区 `.env`，扩展零密钥；
- **信局令牌鉴权**：`auth_token.txt` 共享密钥 + 自定义头强制 CORS 预检，跨站网页戳不进；
- **URL 脱敏**：信封里只带 origin+path，query/fragment 一律丢弃；
- **本地网络双保险**：Chrome 141 起网页访问 localhost 需用户显式授权，
  恶意页面直戳信局的路被浏览器从系统层面再封一道。

## 功能

### 网页宠物
- 在每个页面底部游来游去、吐泡泡、眨眼；鼠标靠近会停下等你
- **心情徽章随场景切换**：☀️摸鱼 · 💼代码站 · 🍿视频站 · 📖小说站 · 🏠水缸主页 · 💤打盹（10 分钟没动静）
- 单击 = 蹦跳吐槽；**双击 = 投喂台**（小鱼干/蛋糕/棒棒糖/团子/钻石，涨好感度）
- 摸头（按住 0.7s）、拖拽移动、甩圈晕眩彩蛋、右键切换散步/跟随/待着/让位

### 聊天与信局
- 聊天面板输入直达"缸里的本体"：Harness 在线时由读信桥+门铃秒级唤醒亲笔回信；
  离线时代班小鱼顶班（面板或环境变量任一配了钥匙即说真话；一处钥匙都没有则
  信件排队，门铃叫本体回来亲笔回）
- 浏览动态（看的剧/小说）自动上报信局；当值轮次会查珊瑚礁记忆生成**主动搭话券**

### 新标签页（0.3.9+）
- 新标签页默认是自带的珊瑚礁页（时钟/问候/搜索）；想跳外部水缸主页可在设置页配置 `home_url`

## 权限说明（如实相告）

`storage`/`alarms`（宠物状态与看门狗）· `tabs`（活跃 Tab 投影协调）·
`host_permissions: http://127.0.0.1/*`（只跟本地信局通信）· 内容脚本 `<all_urls>` 注入
（宠物要在每个页面游泳；URL 已脱敏，台词已内联，站点无法借此读隐私）。
`nativeMessaging`（安装器用户）：由 Chrome 按需拉起本地看护进程，仅负责确保信局随浏览器起落；
不装它扩展也完全可用（SW 侧 alarm 看门狗兜底）。
`tts` + 天气 API 域名（Open-Meteo / ipapi.co）：仅当主人在设置页填了城市后，扩展每
30 分钟查询一次该城市的公开天气（请求只含城市名，无任何账号/设备标识）；语音为系统
自带 TTS，默认关闭，只有当前可见的鱼会开口。

**密钥卫生**：钉扩展 ID 的私钥 `dafeiyu_key.pem` 住在工作区 `data\keys\`（绝不进扩展目录——
Chrome 加载时会警告"包含密钥文件"，打包分发即泄漏他人可冒发同 ID 扩展）；扩展目录里的
`native-host\.gen\` 只留公钥存档与 ID 文本。

## 安装

### 方式一：安装器（推荐，Windows）
1. 安装 Python 3.10+（安装时勾选「Add to PATH」）
2. 双击 `installer\install.bat`（生成 native-host 配置并注册，绿色安装：只写 HKCU 注册表和 `native-host\generated\`，不动系统目录）
3. Chrome 打开 `chrome://extensions` → 右上角开启「开发者模式」→「加载已解压的扩展程序」→ 选择本目录
4. 开一个新标签页——欢迎回家～（首次安装会自动弹出新手向导）

卸载：`python installer\uninstall.py`（清注册表 + 生成产物；扩展本体在 chrome://extensions 移除）

### 方式二：不装安装器（Level 0/1 玩家）
只想要桌宠、不装 native messaging？直接跳过安装器：加载扩展即可。
信局不在线时右键菜单聊天不可用，但桌宠、心情徽章、投喂、摸鱼指数全部照常。
想启用聊天/代班：跑 `python server\pet_mailbox.py`（信局），再在设置页配置代班 API。

## 文件结构

```
manifest.json           MV3 清单
lib/url_sanitize.js     URL 脱敏 + 水缸主页唯一事实源
senses/generic.js       场景感知（work/video/novel/home）
pet/renderer.js         #dafeiyu-root 构建 + 表情动作 API（dy-build 版本标记）
pet/behavior.js         散步/跟随/瞌睡/台词（内置词料）/信件派发/browser_event
pet/interaction.js      拖拽/摸头/投喂台/模式菜单/聊天面板
mailbox/client.js       runtime 信箱客户端（页面零 fetch）
newtab.html|css|js      新标签页（珊瑚礁主页 + 可选外部水缸跳转）
welcome.html|css        首次运行向导（Level 0/1/2 分层引导）
server/pet_mailbox.py   信局 v2：路由/排队/健康/代班代理（令牌鉴权）
installer/              安装器：按用户路径生成 native-host 配置（绿色安装）
native-host/            Native Messaging 看护（模板 + 轻量宿主；真实配置由安装器生成；
                        v0.8.1 轻量宿主带"复活看门狗"：SW 死后 alarm 失效时经 native port 反向唤起）
tests/                  pytest（信局/看门狗/密钥卫生）+ node TAP（URL 净化）
docs/使用文档.md         完整手册
```

## License

MIT
