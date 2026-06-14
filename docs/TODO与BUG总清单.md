# PodPlayer · TODO 与 BUG 总清单（持久·防记忆丢失）

> 2026-06-14 汇总(工作流跨 known-bugs / nas-dev-notes / 主文档待办 / 功能建议 / 各记忆去重，66→53 条) + 本会话更新。
> 单一参考清单;具体细节仍以各源文档为准。状态:🔴open / 🟡pending-verify(已做待真机验) / 🔵in-progress / 🟣paused / ✅done(本会话刚完成,留痕一轮后删)。
> ⚠️ 用户提醒:清单部分条目与现实有出入(碰到再据实核对、勿盲信);**把基础功能做好最重要**。

---

## ✅ 本会话(2026-06-14)已完成（下轮可删）
- ✅ 事故根因(多实例抢 LevelDB 锁)根治 + 实例隔离(PODPLAYER_PROFILE) + §五真机验收 + 已并 master/push
- ✅ 数据事故善后:relink 工具 / 自动备份(userData\backups) / resetApp 加 confirm
- ✅ 仓库改名 Fuji-021/PodPlayer + 用户可见品牌 YesPlayMusic→PodPlayer + README 重写
- ✅ 图标统一为 Lucide 描边(24 个)+ 点击微反馈 + viewBox 微放大;收藏 heart 同步放大
- ✅ NAS hover 提示改自定义干净 tooltip(「NAS 已连接」去原生丑边框)
- ✅ 进度条「标记此刻」+ hover 时间显示 贴边防越界(clamp)
- ✅ 呼吸灯萤火虫式 v2.0(更早完成,用户明确满意——**不是待办**)

---

## 🐞 BUG

### P1
- 🔴 **机核等超大列表 hover 慢半拍 + 进入卡顿** — _startHydration 全量水合钉死主线程;唯一根治=窗口虚拟化(需专开一轮先对抗式设计;先解自绘滚动条/行高)。[known-bugs / 主文档 F1]
- 🔴 **统计页排行重排动画仍有问题** — 已连修 9 轮(v1.5.7);现象待细说,先定位路径(toggle=setRange vs 进页=enterWithAnimation),用 scripts/stats_toggle_repro.js 复现。[known-bugs]

### P2
- 🔴 **统计「最近一周」>「全部」(如岩中花述)** — 数据模型不一致:"全部"读 episodeListenStats 累计、"周"读 listenDaily 按天=两套表,后者有记前者没记全则周>全部。正解=统一数据源(非trivial)。本轮已诊断未修。[listening.js:179]
- 🔴 《思文，败类》首页封面 ≠ 详情页封面 — 疑 name≠RSS title→subscribedMap 查不到 feedUrl→回落旧 logo。
- 🔴 头像二级菜单弹出锁全局滚动 — ContextMenu enableScrolling:false→#main overflow:hidden。
- 🔴 单集列表全量渲染无虚拟化(与机核同源,大档建数百行 DOM)。
- 🔴 「为你推荐」reroll 不换/池只剩 3 — reshuffle 没排除上一批 forYou。
- 🔴 单集详情「加入播放列表」按钮加入后图标过大 + 不能再点移出。[B67-BUG-5]
- 🔴 last.fm 子窗 nodeIntegration+webSecurity:false 历史高危(入口已删,建议收敛/移除)。

### P3（低/边缘/记录）
- 🔴 搜索栏再右移 + 宽度再缩对齐 navbar。[B67-BUG-7]
- 🔴 subscribedMap 以节目名为键→同名节目互相覆盖(评估暂不修)。[B56-5]
- 🔴 searchLocalEpisodes 全表 JS filter 无索引。[B69-F4]
- 🔴 本地搜单集混入未订阅预览(语义待定)。[B69-L1]
- 🔴 播放心跳每秒 2 次 Dexie 写(功耗,可降频)。[B69-F5]
- 🔴 _updateMprisState 监听器永不移除(休眠中,改 once)。[B69-L2]
- 🔴 Player.vue beforeDestroy 漏清 closeQueuePanel(影响≈0)。[B69-L3]
- 🔴 软删记录(subscribed:false)长期堆积(数据量小)。
- 🔴 重启时下载中断成孤儿任务(edge case)。
- 🟡 统计 toggle 残留帧致差集闪现 — 疑 v1.5.7 已根治,留作回归边界。

---

## ✅ TODO

### P1
- 🟡 **NAS P3 中途掉线续播** — 代码已落地(并入 master 3b1db90),**待真机断网验收**(≤5s 续 CDN/误差<2s + NAS 关闭态核心回归)。
- 🔴 桌面通知(新单集/下载完成,须合 Windows 通知框架)。
- 🔴 托盘菜单 + 任务栏缩略图三键(上一首/暂停/下一首)。
- 🔴 听完自动清理已下载单集释放空间。
- 🔴 我的下载页显示存储占用(仅提示)。
- 🔴 播放 bar 进度条用在播单集封面主色(已有 getCoverColor)。

### P2
- 🟡 机核 hover CHUNK→24 真机验收(残留则调 16)。
- 🔴 性能路线:L1 内存缓存→L2 hover 预取(先只对已订阅)→F2 prune→L2 放开未订阅→L3 空闲预热(每轮一步)。
- 🔵 定期 OPML+JSON 自动备份(userData\backups 已就绪,定期导出待做)。
- 🔴 **NAS 源节目「第三大板块」** — navbar 第三板块(首页/我的订阅之外),排版区别于二者(样式未定);是 nas §10 #2「我的NAS栏」升级设想。用户 2026-06-14 提,优先级低、设计未定。
- 🔴 NAS-在档标识(#4:单集/节目「NAS 上有」呼吸点,需设计,别复用来源点)。
- 🔵 NAS 图标黄(慢)态 + 长断联换 wifi-password 图标 + 自动重试/原因提示(#7)。
- 🔴 沉浸式播放页(播放 bar 展开,复用 lyrics.vue)——**下一轮主攻**。
- 🔴 设置页完善(导出收听数据 CSV/JSON、全局媒体热键、同时下载集数1-10 UI、键盘可达)。
- 🔴 睡眠「本集结束」与自动续播队列边界。
- 🟣 多源资源池·Apple 官方榜 adapter(首页板块,paused)。

### P3
- 🔴 重订阅 **15/34 下载未挂回**(文件在 PodPlayerDev\podcasts,需要时精确挂回)。
- 🔴 OPML 重订阅 **28 档 vs ABS 36 档**,差 8 档待核对。
- 🔴 **自动更新源 + in-app GitHub 链接**仍指 qier222/YesPlayMusic(你说后面统一改)。
- 🔴 承重标识彻底自托管/换 logo(Dexie 名/userData 身份/迁移前缀/UA/logo 资源)。
- 🔴 从 NAS 下载(#6,局域网更快,增强)。
- 🟣 首页 NAS 来源板块(#3,留接口,paused)。
- 🔵 清理 NAS 临时调试物(window.podNas 已删,剩余随设置页/图标落地清)。
- 🔴 播放音量渐入(久未播+音量>50% 时 3s 渐大)。
- 🔴 发现页缓存大方向评估(封面/信息/单集/音频)。
- 🟣 多源发现资源池整方案(paused,**唯一阻塞=注册 PodcastIndex 免费 key**)→ ②命中率spike / ③adapter+解析链 / ④搜索双源 / ⑤推荐池扩容 / ⑥RSSHub兜底。
- 🔴 音质(musicQuality) dormant mutation 待专门 dead-code 轮删除。
- 🔴 统计动画 v2「有等待」路线 git 锚点待确认锁定(版本溯源记账)。

---

## 关键状态锚点（接手先看）
- 分支:**已统一在 `master`** 开发(feature/nas-source 已并入、可弃);master=origin=`68da99b`,仓库 `Fuji-021/PodPlayer`。
- 实例隔离:prod=PodPlayer/10754/27232 · dev=PodPlayerDev/10755/27233/devserver20201 · sandbox=PodPlayerSandbox/10756/27234/devserver20202。启动:scripts/start-dev.bat / start-sandbox.bat。
- 数据:用户真实数据在 dev(PodPlayerDev/20201);进度/统计/收藏曾因事故不可恢复、现有自动备份兜底。
- 打包建议:做好后打包**正式版(prod=PodPlayer 身份)**→ 与 dev-serve 零冲突;**勿打包成 dev 身份**(同身份冲突)。
- 关联记忆:[[known-bugs]] [[nas-feature-branch]] [[perf-optimization-goal]] [[dev-environment]] [[versioning-rules]] [[resource-pool-plan-status]] [[discover-redesign-spec]]。
