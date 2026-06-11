// [B-77/L1] 节目详情「内存缓存」：feedUrl → { podcast, episodes }。
//
// 目的：重开同一节目时**先用内存里上次的数据秒显**，再在后台从 Dexie 重读校正
//   (stale-while-revalidate)。省掉每次进节目都要走的 Dexie 读 + 内存排序(数十 ms)，
//   让"刚看过的节目"重开几乎瞬开。注意：它只加速**取数**那一段；上千集的**渲染**仍由
//   F1 后台水合扛(见 perf 计划 F1→L1→…)。非权威数据，仅作首帧加速。
//
// 容量 LRU ~12 档(个人自用够用)；不持久化(仅本次运行的会话内存)。
// 一致性：load() 命中后仍会**无条件**从 Dexie 重读覆盖 → 即便缓存过期也会在同一次 load 内被纠正，
//   故无需精细 invalidate；invalidateEpisodeCache 仅供订阅/取消等场景主动丢弃(可选)。

const _cache = new Map(); // feedUrl -> { podcast, episodes }
const MAX = 12;

export function getEpisodeCache(feedUrl) {
  if (!feedUrl || !_cache.has(feedUrl)) return null;
  const v = _cache.get(feedUrl);
  _cache.delete(feedUrl);
  _cache.set(feedUrl, v); // LRU：命中即提到最新
  return v;
}

export function setEpisodeCache(feedUrl, data) {
  if (!feedUrl || !data) return;
  _cache.delete(feedUrl);
  _cache.set(feedUrl, data);
  while (_cache.size > MAX) {
    _cache.delete(_cache.keys().next().value); // 淘汰最久未用
  }
}

export function invalidateEpisodeCache(feedUrl) {
  if (feedUrl) _cache.delete(feedUrl);
  else _cache.clear();
}
