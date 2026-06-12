// [B-83] 小宇宙单集 shownotes 补全。
//
// 背景：小宇宙对部分节目（按节目设置，非全局）在 RSS 输出里把 shownotes 截断到 ~800 字
//   并加"在小宇宙查看完整…"尾巴，且 <content:encoded> 与 <description> 同为这份截断文本
//   （B-82 补读 content:encoded 对这类源因此空转）。完整文稿不在 RSS 里，但在小宇宙
//   **公开单集网页**（SSR、无需登录）的 __NEXT_DATA__.props.pageProps.episode.shownotes，
//   实测为完整 HTML。这里按需抓取该页补全（仅对 xiaoyuzhoufm.com/episode/<eid> 链接）。
//
// 任何环节失败一律静默返回 ''（降级回原截断描述），不打断单集详情渲染。

import { updateEpisode } from './db';

const electron =
  process.env.IS_ELECTRON === true ? window.require('electron') : null;
const ipcRenderer = electron?.ipcRenderer ?? null;

// 截断尾巴特征（与 db.js 防降级用的同口径）。
const TRUNCATED_TAIL_RE =
  /(在|去)小宇宙.{0,12}(完整|文稿|该单集|查看|收听)|查看完整(的)?(单集)?(简介|文稿|节目内容|shownotes)/i;

// 描述是否疑似被截断（尾部出现"在小宇宙查看完整…"类提示）。
export function looksTruncated(desc) {
  if (!desc) return false;
  return TRUNCATED_TAIL_RE.test(String(desc).slice(-180));
}

// 仅认小宇宙公开单集页链接，规范化为 https；否则返回 ''（不抓任意外链）。
export function xyzEpisodeUrl(link) {
  if (!link) return '';
  const s = String(link).trim();
  if (!/^https?:\/\/(www\.)?xiaoyuzhoufm\.com\/episode\/[a-z0-9]+/i.test(s)) {
    return '';
  }
  return s.replace(/^http:/i, 'https:');
}

// 抓单集页、解析出完整 shownotes HTML。失败/非小宇宙链接 → ''。
export async function fetchXyzShownotes(episodeLink) {
  const url = xyzEpisodeUrl(episodeLink);
  if (!url || !ipcRenderer) return '';
  let res;
  try {
    res = await ipcRenderer.invoke('podcast:fetchEpisodePage', url);
  } catch (e) {
    return '';
  }
  if (!res || !res.ok || !res.text) return '';
  const m = res.text.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return '';
  let j;
  try {
    j = JSON.parse(m[1]);
  } catch (e) {
    return '';
  }
  const ep = j && j.props && j.props.pageProps && j.props.pageProps.episode;
  return ep && typeof ep.shownotes === 'string' ? ep.shownotes : '';
}

// 一个 episode 是否"小宇宙截断、值得补全"。
function isEnrichCandidate(ep) {
  if (!ep || ep.xyzFull) return false;
  if (!xyzEpisodeUrl(ep.link)) return false;
  const cur = ep.description || '';
  return looksTruncated(cur) || cur.length < 1200;
}

// 补全单个 episode：抓完整 shownotes、命中更长文稿则写库(打 xyzFull)，返回完整 description；
//   非候选 / 失败 / 不更长 → 返回 ''(调用方据此决定是否替换视图)。
export async function enrichEpisodeShownotes(ep) {
  if (!isEnrichCandidate(ep)) return '';
  const cur = ep.description || '';
  const full = await fetchXyzShownotes(ep.link);
  if (!full || full.length <= cur.length) return '';
  try {
    await updateEpisode(ep.id, { description: full, xyzFull: true });
  } catch (e) {
    /* 持久化失败不影响本次返回，调用方仍可用于显示 */
  }
  return full;
}

// [B-83→预取] 列表级后台预取：进节目详情时，把该档"截断未补全"的单集限流抓好写库，
//   使用户点进单集时完整内容已在本地、秒显无闪。每集只抓一次(xyzFull)、失败静默。
export async function prefetchShownotesForEpisodes(episodes, opts) {
  const o = opts || {};
  const limit = o.limit || 30; // 单次最多预取多少集(优先列表靠前=最新)
  const concurrency = o.concurrency || 2; // 并发抓取数(克制，别打爆小宇宙)
  const targets = (episodes || []).filter(isEnrichCandidate).slice(0, limit);
  if (!targets.length) return 0;
  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < targets.length) {
      const ep = targets[idx++];
      try {
        const full = await enrichEpisodeShownotes(ep);
        if (full && typeof o.onEnriched === 'function')
          o.onEnriched(ep.id, full);
        if (full) done++;
      } catch (e) {
        /* 单集失败不影响其它 */
      }
    }
  };
  const n = Math.min(concurrency, targets.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return done;
}
