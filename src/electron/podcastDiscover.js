// [B-39 播客改造] 主进程：首页"发现"数据。
// - 热门榜单：xyzrank.com/api/podcasts（必须带 Referer，否则反爬返回 SPA HTML）
// - Apple id → RSS feedUrl：itunes.apple.com/lookup
// 在主进程抓取以绕过渲染进程的 CORS；proxy:false 直连（交给 Clash TUN 网卡层路由）。
import axios from 'axios';
import { ipcMain } from 'electron';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 YesPlayMusicPodcast/0.1';

// 简单内存缓存：榜单每天才更新，缓存 6h 减少请求 + 离线兜底
let hotCache = { ts: 0, items: null };
const HOT_TTL = 6 * 3600 * 1000;
// Apple id → feedUrl 缓存（基本不变，长期缓存）
const feedCache = new Map();

export function registerPodcastDiscoverIpc() {
  // 抓热门播客榜单
  ipcMain.handle('podcast:fetchHot', async (_e, force) => {
    const now = hotCache.ts; // 注意：Date.now() 在运行时可用
    if (!force && hotCache.items && Date.now() - now < HOT_TTL) {
      return { ok: true, items: hotCache.items, cached: true };
    }
    try {
      const res = await axios.get('https://xyzrank.com/api/podcasts', {
        headers: {
          'User-Agent': UA,
          Referer: 'https://xyzrank.com/',
          Accept: 'application/json',
        },
        timeout: 20000,
        proxy: false,
        validateStatus: s => s >= 200 && s < 300,
      });
      const items = (res.data && res.data.items) || [];
      if (items.length) {
        hotCache = { ts: Date.now(), items };
      }
      return { ok: true, items };
    } catch (err) {
      // 失败时如果有旧缓存，降级返回旧的
      if (hotCache.items) {
        return { ok: true, items: hotCache.items, stale: true };
      }
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // 从 Apple Podcasts id 反查 RSS feedUrl
  ipcMain.handle('podcast:resolveFeed', async (_e, appleId) => {
    if (!appleId) return { ok: false, error: '缺少 appleId' };
    if (feedCache.has(appleId)) {
      return { ok: true, feedUrl: feedCache.get(appleId) };
    }
    try {
      const res = await axios.get(
        `https://itunes.apple.com/lookup?id=${encodeURIComponent(
          appleId
        )}&entity=podcast`,
        {
          headers: { 'User-Agent': UA },
          timeout: 15000,
          proxy: false,
        }
      );
      const r = ((res.data && res.data.results) || [])[0];
      const feedUrl = r && r.feedUrl;
      if (feedUrl) feedCache.set(appleId, feedUrl);
      return { ok: true, feedUrl: feedUrl || '' };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // [B-52] 在线搜索播客（iTunes Search API，中文区，直接返回 feedUrl → 可一键订阅/预览）
  ipcMain.handle('podcast:search', async (_e, term) => {
    const q = String(term || '').trim();
    if (!q) return { ok: true, items: [] };
    try {
      const res = await axios.get('https://itunes.apple.com/search', {
        params: { term: q, entity: 'podcast', country: 'cn', limit: 30 },
        headers: { 'User-Agent': UA },
        timeout: 15000,
        proxy: false,
        validateStatus: s => s >= 200 && s < 300,
      });
      const results = (res.data && res.data.results) || [];
      // 映射成发现页卡片(DiscoverCard)能直接用的结构；带 feedUrl 可跳过 resolveFeed
      const items = results
        .filter(r => r && r.feedUrl)
        .map(r => ({
          id: r.feedUrl,
          name: r.collectionName || r.trackName || '',
          author: r.artistName || '',
          logoURL: r.artworkUrl600 || r.artworkUrl100 || r.artworkUrl60 || '',
          primaryGenreName: r.primaryGenreName || '',
          avgPlayCount: 0,
          feedUrl: r.feedUrl,
          trackCount: r.trackCount || 0,
        }));
      return { ok: true, items };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}
