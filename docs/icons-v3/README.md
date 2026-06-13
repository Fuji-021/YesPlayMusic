# 图标 v3 交付（23 个 svg + animations.css）

> 由审查 session 按统一规范（Lucide 线性：24 网格 / 2px / round / `currentColor`）生成。审查 session 不直接动 `src/`，本目录是交付物——**由主 session 拷贝落地**到 `src/assets/icons/`。
> 动效共 8 个（标记/删除/节目/清理/下载/收藏/加入列表/排序），动件已包成 `<g class="ani-*">`，keyframes 在 `animations.css`。其余纯静态。

## 落地步骤（主 session）

1. 把本目录 svg 覆盖 `src/assets/icons/`（按下表"替换旧文件"对应）。
2. 把 `animations.css` 内容并入全局样式（或 svg-icon 组件样式）。
3. 一次性动效：在触发处给图标元素加 `.play` class、`animationend` 后移除（下载/节目是常驻、无需 .play）。
4. 状态色（不写进 svg，由使用处着色）：已订阅 / 已加入 / 已完成 = `--color-success`(绿)；收藏(已) = `--color-danger`(红)。
5. 删孤儿（见 `docs/图标审计.md` 第二节）。

## 新旧映射表（新文件 → 替换项目里旧文件 → 用途 / 动效）

| 新文件 | 替换旧文件 | 用途 | 动效 |
|---|---|---|---|
| download.svg | download.svg | 下载 | ✦ 箭头跳（常驻=下载中） |
| node.svg | radio-alt.svg | 节目 | ✦ 信号扩散（常驻=在播） |
| bookmark.svg | **social-network.svg** | 播放条时间标记 | ✦ 轻下沉（点击） |
| trash.svg | trash.svg | 删除下载 | ✦ 掀盖（点击） |
| clean.svg | clean.svg | 清理角标 | ✦ 橡皮擦动（点击） |
| favorite.svg / favorite-on.svg | heart.svg / heart-solid.svg | 收藏 未/已 | ✦ 已态心跳（点击） |
| playlist-add.svg / playlist-added.svg | layer-plus.svg /（新增已态） | 加入列表 未/已 | ✦ +↔✓ 切换（点击） |
| sort.svg | sort-alt.svg | 排序 | ✦ 双箭头上下（点击；箭头已加长） |
| queue.svg | queue.svg / queue-alt.svg | 队列（去音符） | 静态 |
| sleep.svg | moon.svg | 睡眠定时 | 静态 |
| play-circle.svg | play-circle.svg | 插播（三角已调大） | 静态 |
| subscribe.svg / subscribed.svg | square-plus.svg / checkbox.svg | 订阅 未/已 | 静态 |
| unsubscribe.svg | heart-crack.svg | 取消订阅 | 静态 |
| duration.svg | duration.svg | 单集时长 | 静态 |
| discover.svg | compass-alt.svg | 发现 | 静态 |
| block.svg | ban.svg | 屏蔽 | 静态 |
| refresh.svg | refresh.svg | 刷新 | 静态 |
| history.svg | time-past.svg | 收听历史 | 静态 |
| enter.svg | arrow-right.svg | 进入/更多 | 静态 |
| completed.svg | check-circle.svg | 已完成/已下载 | 静态 |

## 保留不重绘（本目录不含、照旧）

- NAS：`router-wifi-alt.svg` / `wifi.svg`（机器+wifi 自绘）
- 品牌：`on-air-square.svg`（logo）
- 首页"再来一瓶"：`bottle-cap.svg`（瓶盖，呼应文案趣味）

## 已定决策（2026-06-13 用户拍板）

- 三点菜单 `menu-dots-vertical`：**不统一**，项目原样保留。
- 首页板块行尾"进入/更多"：**统一改用 `enter.svg`**（箭头）——把 `home.vue` 各板块的 `actionIcon`（`compass-alt` 等）换成 `enter`；**唯独"再来一瓶"板块例外，保留 `bottle-cap` 瓶盖**（趣味语义）。
- 动效强度可在 `animations.css` 调（时长/幅度）；排序、加入列表如需常驻演示改 `infinite`。
