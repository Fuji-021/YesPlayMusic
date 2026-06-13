# NAS 音源方案（飞牛OS · Audiobookshelf 归档 + 三级解析链）

> 2026-06-13 ｜ 性质：功能方案（待主 session 在**独立分支**实施）
> 用户约束（硬性）：仅局域网使用（在外用小宇宙 app，无移动端计划）；NAS=192.168.2.108（fnOS，Web 5666 端口）；播客配额 **400GB**（盘共 900G）；**低耦合铁律——NAS 断网/断电/服务挂掉时，体验必须等于今天，绝不能"这里挂了全部挂了"**；最坏情况可整体回溯。

---

## 一、总架构：两个独立系统 + 一条可熔断的薄胶水

```
┌─ NAS 侧（独立运行，app 不依赖它）────────────┐
│ fnOS Docker → Audiobookshelf(ABS)            │
│ OPML 导入订阅 → 24h 自动追新归档到磁盘        │
│ 产出：纯 mp3 文件目录 + HTTP 流式 API         │
└──────────────────────────────────────────────┘
                 ↑ 唯一交点（可熔断）
┌─ App 侧（现有系统，行为不变）─────────────────┐
│ _getAudioSource 三级解析链：                  │
│ ① 本地已下载(pathMap→file://)  ←现状，不动    │
│ ② NAS 命中(探测+映射，超时即跳过) ←新增的唯一一级│
│ ③ 原始 CDN(podcastAudioUrl)    ←现状，不动    │
└──────────────────────────────────────────────┘
```

解耦的三重保证：**(a)** NAS 侧是现成开源软件（[Audiobookshelf](https://github.com/advplyr/audiobookshelf)），与 app 零代码耦合，归档以纯文件形式存在——即使 ABS 本身挂了，文件还在、可 SMB 访问；**(b)** app 侧只插一级解析，前后两级就是今天的现状；**(c)** 功能开关默认关闭，未配置 NAS 地址时新代码路径完全不激活。

## 二、NAS 侧部署（零代码，半天）

1. **固定 IP**：在路由器做 DHCP 保留，钉死 192.168.2.108（地址漂移是这类方案最常见的"莫名失效"原因）。
2. **fnOS Docker 装 ABS**（fnOS 自带 Docker 面板，支持 compose）：
   ```yaml
   services:
     audiobookshelf:
       image: ghcr.io/advplyr/audiobookshelf:latest
       ports: ["13378:80"]
       volumes:
         - /vol1/podcasts:/podcasts      # 归档目录（按 fnOS 实际存储卷路径调整）
         - /vol1/abs/config:/config
         - /vol1/abs/metadata:/metadata
       restart: unless-stopped
   ```
3. **导入订阅**：app 已有 OPML 导出（B-51）→ ABS 建 Podcast 库 → 导入 OPML。
   ⚠️ 已知坑（[issue #2160](https://github.com/advplyr/audiobookshelf/issues/2160)）：OPML 导入的节目**自动追新开关可能没生效**，导入后需逐档/批量把 Schedule 里的 auto-download 打开并核对一次。
4. **400G 配额策略**：ABS 的保留策略按"每档保留集数"而非 GB。估算：中文播客均集 ~50MB，400G ≈ **8000 集**。建议口径（可调）：核心节目（罗永浩/半拿铁这类常回听的）保留全集，其余每档 Limit episodes to keep = 50~100；fnOS 存储页每月看一眼占用即可。回填历史单集：ABS 支持手动批量下载旧集，按需对核心节目执行。
5. **验收**（Phase 0 出口条件）：浏览器直接打开 ABS 给出的某单集流 URL 能播放、能拖动（Range 生效）；记下 API token（设置→用户→API Token）。

## 三、App 侧设计

### 3.1 注入点（读码锚定，全方案唯一触碰现有逻辑的位置）

`Player.js _getAudioSource(track)`（:652-671）现状即两级：pathMap 本地 → `track.podcastAudioUrl`。NAS 作为第②级插入，**函数已返回 Promise，契约不变**：

```js
// ① pathMap 命中 → file:///（原样保留，最高优先级，下载逻辑完全不动）
// ② [新增] NAS：
if (nasEnabled()) {
  const nasUrl = await resolveNasUrl(track.podcastEpisodeId); // 含超时与缓存，失败返回 null
  if (nasUrl) return nasUrl;
}
// ③ return track.podcastAudioUrl;（原样保留）
```

### 3.2 新增模块（全部是新文件，不改既有文件除上述注入点与设置页）

| 模块 | 进程 | 职责 |
|---|---|---|
| `electron/nasBridge.js` | 主进程 | 持有 NAS 地址+token（本地配置，**不进 git**）；IPC：`nas:probe`（健康检查）、`nas:resolve`（episodeId→流URL）。走主进程 axios——沿用项目惯例，规避渲染进程网络被代理拦截的旧坑（_getAudioSource 注释里 ERR_CONNECTION_CLOSED 前车之鉴） |
| `src/utils/podcast/nasSource.js` | 渲染 | `resolveNasUrl()` 封装：可用性短路 → 映射缓存查询 → IPC 解析 → 结果落 Dexie 缓存 |
| 设置页新区块 | 渲染 | 开关（默认关）+ 地址 + token + "测试连接"按钮 + 实时状态点（绿=在线/灰=未启用/红=不可达） |

### 3.3 可用性探测（熔断器，低耦合的核心）

- 内存态 `nasAlive`：启动时探测一次 + 每 5 分钟后台心跳 + 每次播放前若距上次探测 >30s 则再探，**单次探测超时 800ms**。
- `nasAlive=false` → `resolveNasUrl` **同步返回 null**（零等待直落 CDN）；后台心跳继续，恢复后自动回 NAS。
- 探测失败**不弹任何窗**；状态只反映在设置页状态点（可选：播放条 hover 显示当前音源 "本地/NAS/在线"小字，便于验收）。

### 3.4 episode → NAS 文件映射（可靠性关键）

**不猜文件名**。走 ABS API：按 feedUrl 匹配 library item → 按单集 **enclosure URL（首选，归档时的原始直链）/ guid / 标题+日期（兜底）** 匹配 episode → 取流 URL。映射结果写 Dexie（`episodeId → {nasUrl, ts}`，TTL 7 天），命中缓存时一次 IPC 都不用发。具体端点字段以 Phase 0 实测 ABS API 为准（api.audiobookshelf.org 有文档，**先 spike 验证再写代码**——R8 的教训：关键假设未实测不合入）。

### 3.5 断联语义表（每一种失败的行为，验收按此逐条过）

| 场景 | 行为 | 用户感知 |
|---|---|---|
| 未启用/未配置 | ②级代码路径不执行 | 与今天完全相同 |
| NAS 关机/断网（播放前） | 探测失败 → nasAlive=false → 直落 CDN | 与今天完全相同（多 ≤800ms 仅首次探测时） |
| 映射查不到该集（NAS 还没归档到） | resolve 返回 null → 落 CDN | 无感 |
| **播放中途 NAS 掉线** | howler `loaderror/playerror` → 仅当当前源是 NAS URL 时：记下当前 progress → 用 ③CDN URL 重建 howler → seek 回原进度续播 → nasAlive=false | 短暂缓冲后续播，进度不丢 |
| token 失效/ABS 升级接口变动 | resolve 报错按"查不到"处理 → 落 CDN；设置页状态点变红 | 无感，体验回到今天 |
| NAS 恢复 | 心跳探活 → 下一集起自动回 NAS | 无感 |

> 中途掉线重建是唯一需要新增的播放器行为（~60 行，挂在现有 howler 错误回调上，且**仅对 NAS 源激活**——CDN/本地源的错误处理路径保持现状）。

## 四、防回归工程纪律（按用户要求逐条落实）

1. **分支**：`feature/nas-source`，从当前 master 切出；**所有提交只进该分支**，真机验收全过后才合并；最坏情况 `git branch -D` 整体丢弃，master 零污染。
2. **默认 OFF 双保险**：未配置地址 = 路径不激活（代码级）；设置开关默认关（配置级）。合并后即使有未发现的 bug，不开开关就等于没合并。
3. **禁碰清单**（写进分支首个 commit message，约束后续轮次）：`downloads.js` 及下载 IPC、`refreshAllSubscriptions`、统计页、动画、睡眠定时器、`_getAudioSource` 的①③两级原文。
4. **回归清单**（合并前必过）：在线播放/已下载播放/下载新集/进度保存恢复/收听统计 tick/睡眠定时/切集自动续播——**全部在 NAS 关闭态跑一遍**（证明未启用=现状），再在 NAS 开启态跑一遍。
5. **回归脚本可选项**：`scripts/` 下加 nas 解析链单测（fake IPC，断言三级 fallback 次序与超时短路），与 sleep/stats 复现脚本同栏目。

## 五、实施阶段（每段独立可验，出口条件不满足不进下一段）

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **P0 · NAS spike**（半天，零 app 代码） | 部署 ABS + OPML 导入 + 开自动追新；手动验证流 URL 浏览器可播可拖；实测 ABS API 拿到一集的流 URL（记录端点与字段） | 浏览器播放 NAS 单集 ✓ + API 映射路径确认 ✓ |
| **P1 · 解析链**（~150 行） | nasBridge + nasSource + ②级注入 + 探测熔断 | 断联语义表前 4 行验收通过 |
| **P2 · 设置页**（~80 行） | 开关/地址/token/测试连接/状态点 | 配置→生效→关闭→回现状，全程无重启 |
| **P3 · 中途断联恢复**（~60 行） | NAS 源错误 → CDN 重建 + seek 续播 | 播放中停 ABS 容器，5s 内自动续播、进度误差 <2s |
| **P4 · 合并验收** | 第四节回归清单双态全过 | 合并 master，开关仍默认关，观察一周再默认开 |

## 六、预期收益与诚实边界

收益：海外托管节目起播/拖动 seek 局域网毫秒级；**链接失效免疫**（her 山石/shownotes 截断这类平台侧劣化，归档把音频+当时元数据钉死在自己手里）；重听零流量；存储压力从 PC 移到 NAS。
边界：小宇宙托管节目（国内 CDN 本来就快）提升有限；体验"丝滑"的另一半在 UI 层（F1 单集列表分批渲染等），本方案不替代那些项；NAS 单盘 400G 无冗余，归档非备份——核心数据（收听进度/统计）仍在 app 本地 Dexie，与 NAS 无关。

## 七、待用户提供（P0 后）

1. ABS 装好后的端口（建议 13378）与 API token。
2. 每档保留口径拍板：哪些节目全集、其余保留多少集。
3. （可选）是否要播放条上的"当前音源"小标识，便于日常确认 NAS 命中率。

---

## 八、P0 实施进展记录（2026-06-13，第三方审查 session 执行 · 全部实测）

> 本节为交接记录：**主开发 session 目前对本方案不知情**，接手时请先通读全文，第四节防回归纪律与"默认 OFF 双保险"为硬性要求。

### 已打通（每项均为真机/真 NAS 实测，非推断）

1. **ABS 部署完成且健康**：fnOS Docker（compose 项目 `audiobookshelf`，位于 `/vol1/1000/PodPlayer/`），ABS **v2.35.1**，端口 **13378**。`/healthcheck`=200、`/ping`=success、`/status` 已初始化。
2. **Podcast 库建立 + OPML 导入全量成功**：库 id `c4379a59-72a4-4b8f-8f89-5170602f8469`，**36 档**节目全部入库（即 app 的全部订阅）。
3. **API token 验证有效**（token 名 `downL`；⚠️ **明文不入文档不入 git**，需要时由用户提供，主 session 应存主进程本地配置 + gitignore，见第五节安全段）。
4. **关键端点行为实测清单**（P1 施工的事实依据）：

| 端点 | 实测结论 |
|---|---|
| `GET /api/libraries` / `…/{lib}/items?limit=200` | 列库与节目，`media.metadata.{title,feedUrl}` 可作映射键 |
| `GET /api/podcasts/{itemId}/checknew?limit=N` | **只查 `lastEpisodeCheck` 时间戳之后发布的集**（默认=导入时刻 → 永远返回 0，这就是 UI 强迫填"在此日期后查找"的原因）；返回的集**自动入队下载**，无需再调 download-episodes |
| `PATCH /api/items/{itemId}/media` | 可写 `lastEpisodeCheck`（置 1=回溯到 1970 → checknew 即可全量回灌）、`autoDownloadEpisodes`、`maxEpisodesToKeep` |
| `GET /api/libraries/{lib}/episode-downloads` | 下载队列（currentDownload + queue）；**队列是内存态，容器重启即清空**（实测，曾用于纠正误入队的 949 集全集任务） |
| `GET /api/items/{itemId}?expanded=1` | `media.episodes[]` 含每集元数据与 `audioFile.metadata.size`（真实文件体积）——**这就是 3.4 节"episode→NAS 文件映射"的查询路径雏形** |

5. **全库体积投影（36 档 feed 的 enclosure 字节实测）**：单集 **24~303MB、中位 ≈100MB**（极端值：FView Friday 303MB、罗永浩 279MB、能力有限电台 24MB）；**"每档最新 100 集"合计 ≈330GB**，在 400G 预算内（余量 ~70G）。
6. **批量归档已触发并运行中**：脚本化"PATCH lastEpisodeCheck=1 → checknew?limit=100"逐档执行，36 档全部成功——31 档各入队 100 集、小体量档全集（西西弗高速 29/谐星番外 18/不蒋道李 30/三分音福 57/岛必叨 74/野声宝库 91/岩中花述 82/接触印相 97），**总队列 3134 集**；罗永浩 feed 仅暴露 30 集、此前已全量归档完毕（checknew=0 属正常）。
7. **追新与容量自动化已配置**：36 档全部 `autoDownloadEpisodes=true` + `maxEpisodesToKeep=100`——新单集每日自动下载、超 100 集自动清最老，预算不膨胀；OPML 导入后 auto-download 不生效的已知坑（issue #2160）由此绕过。

### 剩余事项（按序，完成即可向主 session 发令）

1. **等批量下载跑完**（~330GB，预计 1~2 天，ABS 单线程逐集下）→ 跑"实际占用 vs 330GB 投影"核对（可用 expanded=1 汇总 audioFile.size，或看 fnOS 存储页）。
2. **P0 出口最后一项（发令前必做）**：实测完整映射链——`feedUrl → items 匹配 → episodes[] 按 enclosure URL/guid 匹配单集 → 取流 URL → 浏览器可播放可拖动（Range）`，把流 URL 的确切形态与鉴权方式记录进本文档 3.4 节。
3. **待确认**：compose 卷是否已按第二节建议迁到 `/vol1/1000/PodPlayer/{podcasts,abs-config,abs-metadata}`（影响文件管理器可见性与归档归属，不影响功能；若未迁，趁早迁需重灌——330G 下完再迁代价大，**建议立刻确认**）。
4. 然后才进入 **P1**：主 session 开 `feature/nas-source` 分支按三、四节施工。交接要点：注入点=`Player.js _getAudioSource`(:652) 一处；熔断 800ms；断联语义表逐行验收；禁碰清单写进首个 commit。
5. **方法论提醒（给主 session）**：本节所有端点结论均为实测得出，但 ABS 升级可能改变行为——P1 写代码前用 token 把第 4 点的映射链**亲手复核一遍**再动手（R8/R9 的教训：关键假设未实测不合入）。

---

## 九、运维事件 ① 下载卡死 + watchdog 兜底（2026-06-13 实测处理）

> 批量归档期间首次暴露的稳定性问题，已定位 + 恢复 + 落地外部兜底。**主 session 接 P1 时此条是"app 侧必须做熔断、不能假设 ABS 永远健康"的实证依据。**

**现象**：用户报"下载卡住"。API 实测：`currentDownload` 卡在「东腔西调 Vol.235」（喜马拉雅源 guid `xmly_track_`）达 **605 分钟纹丝不动**，`startedAt` 恒 null、`failed` 恒 false；下载 worker 空转（下载队列 UI 显示"当前没有正在进行的下载"）；`GET /api/podcasts/{id}/clear-queue` 返回 200 却清不动队列（357→357）。

**根因（确证机制 + 推断诱因）**：ABS 播客下载单线程逐集、**无硬超时**。某集源（喜马拉雅 CDN）出现"连上但不吐数据"的半开连接 → 请求无限挂起、既不成功也不失败 → ABS 跳过/重试逻辑不触发 → 唯一下载槽被僵尸请求占死 → 后续全队列（357 集）堵塞。一次偶发网络挂起被放大成近 10h 瘫痪。软手段（UI 取消 / API clear-queue）全部无效——下载管理器状态机已冻结，只有重启进程能解。具体是否该集源每次必卡，未确证（倾向偶发 CDN 抖动）。

**恢复（已执行）**：`docker restart` 容器 → 内存死锁 + 队列一并清空 → 健康恢复（queueLen 0、current null）。复核磁盘缺口：36 档里仅 **4 档**未下满（东腔西调 42、限时肤浅 / FView Friday / 能力有限电台 各 0；其余 32 档已下满 100 或小档全集）。逐档 `PATCH lastEpisodeCheck=1 + checknew?limit=100` 精准补回（已下集自动跳过、幂等），总队列回到 ~361，实测下载正常推进（15s 内 current 换集、queueLen 降、磁盘集数涨）。东腔西调入队时**故意排末尾**——它是已知卡死源，若再卡不连累其余档。

**兜底（已落地）**：`docs/abs-watchdog.py`（Python 标准库、零依赖、双模式）+ `docs/docker-compose.watchdog.yml`。**推荐以 Docker 容器常驻**（与 ABS 同宿主、飞牛面板可管、重启走挂载的 `docker.sock`、容器内不用装 docker CLI），亦支持宿主 cron 单次。每 20min 探测 `episode-downloads`，`currentDownload` 存活 > 30min 判卡死 → 自动重启 ABS 容器 + 全档 `checknew` 重新入队（幂等）；当日重启上限 4 次防风暴；token 存本地 600 文件或环境变量、不进 git。部署见脚本 / compose 头注释。

**对 P1 的启示（重要）**：坐实 3.3 节熔断设计的必要性——ABS 会以"**看似健康（HTTP 200）、实则下载子系统冻结**"的形态故障。故 app 侧 `resolveNasUrl` 的探测**不能只看 `/healthcheck`**；取流后还要对"数据流是否真的在动"设防（沿用断联语义表"播放中途掉线"行：howler 无数据 → 超时 → 落 CDN）。NAS 作为音源的可靠性边界，比"NAS 在线"更严格。

---

## 十、运维事件 ② 存储总量上限（驱逐）+ watchdog v2（2026-06-13）

> 用户诉求：全部节目总占用限制在 **500G** 以内。ABS 自身只有「每档保留集数」（`maxEpisodesToKeep`），**无全库总容量上限**，故并入 watchdog 外部管。

**现状数据（实测）**：`/api/libraries/{lib}/items` 每个 item 自带 `size`（36/36 有），求和即总占用——当前 **220GB**，满载投影 ~330GB，**均 < 500G，驱逐短期不会触发**。

**删除接口（安全探测坐实，未做真删）**：用不存在的假 episodeId 探测——
- `DELETE /api/items/{id}/episode/{epId}` → Express「Cannot DELETE」HTML = **路由不存在**；
- `DELETE /api/podcasts/{itemId}/episode/{epId}` → ABS 自家「Not Found」纯文本 = **路由存在**（正解）。
与 `maxEpisodesToKeep` 同机制、**真释放磁盘文件**。单集排序键 `publishedAt`（ms）、容量 `size`。

**watchdog v2（已落地，`docker-compose.watchdog.yml` 自包含版内嵌脚本）**：在原「下载卡死重启」之外，每轮加 `check_storage()`——日志报 `storage: XGB / cap 500GB`；超 `STORAGE_CAP_GB` 且 `EVICT_ENABLED=1` 时，跨档按 `publishedAt` 升序删最老的集到 `STORAGE_TARGET_GB`(480)，**每档保留最近 `KEEP_MIN_PER_PODCAST`(10) 集、绝不删空、不删节目**。`EVICT_ENABLED=0` = 只监测不删。删后复测总量并记日志。

> 诚实边界：删除接口为「假 id 探测路由存在」+「与 maxEpisodesToKeep 同机制」双重推断，**未做真删验证**（不拿用户数据试）。首次真要依赖前，可临时调低 cap 触发一次、看日志 `evicted N episodes ~XGB freed` 坐实。
