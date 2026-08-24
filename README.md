# 大肥鱼的水缸 🐳

> 一只住在浏览器里的蓝胖鲸：网页宠物 + 水缸新标签页 + 本地信局聊天。Chrome MV3。
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
- 新标签页瞬间重定向回水缸主页 `browser/start.html`，本鱼登场迎接；
  未授权 file 访问时留在自带珊瑚礁页（时钟/问候/搜索）

## 权限说明（如实相告）

`storage`/`alarms`（宠物状态与看门狗）· `tabs`（活跃 Tab 投影协调）·
`host_permissions: http://127.0.0.1/*`（只跟本地信局通信）· 内容脚本 `<all_urls>` 注入
（宠物要在每个页面游泳；URL 已脱敏，台词已内联，站点无法借此读隐私）。

## 安装

1. Chrome 打开 `chrome://extensions`，右上角开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本目录；**改代码后记得点「重新加载」**
3. 启动信局：`.venv\Scripts\python.exe server\pet_mailbox.py`（或由 Harness 托管）
4. 开一个新标签页——欢迎回家～

## 文件结构

```
manifest.json           MV3 清单
lib/url_sanitize.js     URL 脱敏 + 水缸主页唯一事实源
senses/generic.js       场景感知（work/video/novel/home）
pet/renderer.js         #dafeiyu-root 构建 + 表情动作 API（dy-build 版本标记）
pet/behavior.js         散步/跟随/瞌睡/台词（内置词料）/信件派发/browser_event
pet/interaction.js      拖拽/摸头/投喂台/模式菜单/聊天面板
mailbox/client.js       runtime 信箱客户端（页面零 fetch）
newtab.html|css|js      新标签页（重定向跳板 + 珊瑚礁兜底）
server/pet_mailbox.py   信局 v2：路由/排队/健康/代班代理（令牌鉴权）
tests/                  pytest（信局）+ node TAP（URL 净化）
docs/使用文档.md         完整手册
```

## License

MIT
