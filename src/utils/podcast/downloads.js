// [B-31 播客改造] Renderer 端下载封装
// - startDownload / cancelDownload / removeDownload
// - 注册 IPC 监听把进度推到 store.podcastDownloads.progressMap
// - 完成后写 Dexie episodeDownloads，并清掉 progress
import { db } from '@/utils/db';
import store from '@/store';

const ipcRenderer = window.require
  ? window.require('electron').ipcRenderer
  : null;

let _registered = false;

// [B-52] 下载并发上限（默认 3；后续可由设置"同时下载集数 1-10"覆盖）
let MAX_CONCURRENT = 3;
const _activeSet = new Set(); // 正在下载的 episodeId
const _waitQueue = []; // 排队等待的 episode 对象

// [B-52] 接口预留：设置层调用以覆盖并发上限（1=队列依次下载，>1=并发）。范围 1~10。
export function setDownloadConcurrency(n) {
  const v = Number(n);
  if (v >= 1 && v <= 10) MAX_CONCURRENT = Math.floor(v);
}
export function getDownloadConcurrency() {
  return MAX_CONCURRENT;
}

// 实际向主进程发起下载（不含并发判断）
async function _doStart(episode) {
  store.commit('setDownloadProgress', {
    episodeId: episode.id,
    bytesDone: 0,
    bytesTotal: 0,
    status: 'downloading',
  });
  const idx = (episode.id || '').indexOf('::');
  const feedUrl = idx > 0 ? episode.id.slice(0, idx) : '';
  const guid = idx > 0 ? episode.id.slice(idx + 2) : episode.guid || episode.id;
  const res = await ipcRenderer.invoke('podcast:download:start', {
    episodeId: episode.id,
    feedUrl,
    guid,
    audioUrl: episode.audioUrl,
  });
  if (!res || !res.ok) {
    _activeSet.delete(episode.id);
    store.commit('clearDownloadProgress', episode.id);
    store.dispatch('showToast', '下载启动失败：' + ((res && res.error) || ''));
    _pump();
  }
  return res || { ok: false };
}

// 槽位空出时，从等待队列拉起下一个
function _pump() {
  while (_activeSet.size < MAX_CONCURRENT && _waitQueue.length) {
    const ep = _waitQueue.shift();
    _activeSet.add(ep.id);
    _doStart(ep);
  }
}

// 在 app 启动时调用一次，把进度/完成/失败的 IPC 事件接到 store
export function registerDownloadListeners() {
  if (_registered || !ipcRenderer) return;
  _registered = true;
  ipcRenderer.on('podcast:download:progress', (_e, p) => {
    if (!p || !p.episodeId) return;
    store.commit('setDownloadProgress', {
      episodeId: p.episodeId,
      bytesDone: p.bytesDone || 0,
      bytesTotal: p.bytesTotal || 0,
      status: 'downloading',
    });
  });
  ipcRenderer.on('podcast:download:done', async (_e, p) => {
    if (!p || !p.episodeId) return;
    // 取写入 DB 用的 podcastId（episodeId 格式 `${feedUrl}::${guid}`）
    const idx = p.episodeId.indexOf('::');
    const podcastId = idx > 0 ? p.episodeId.slice(0, idx) : '';
    try {
      await db.episodeDownloads.put({
        id: p.episodeId,
        podcastId,
        filePath: p.filePath,
        bytesTotal: p.bytesTotal || 0,
        status: 'done',
        addedAt: Date.now(),
      });
    } catch (e) {
      console.error('[downloads] DB put 失败', e);
    }
    store.commit('clearDownloadProgress', p.episodeId);
    // [B-35] 带上本地路径，供 Player 同步取 file:// 离线播放
    store.commit('addDownloadedEpisode', {
      id: p.episodeId,
      filePath: p.filePath,
    });
    store.dispatch('showToast', '下载完成');
    // [B-52] 释放槽位，拉起排队中的下一个
    _activeSet.delete(p.episodeId);
    _pump();
  });
  ipcRenderer.on('podcast:download:error', (_e, p) => {
    if (!p || !p.episodeId) return;
    store.commit('clearDownloadProgress', p.episodeId);
    store.dispatch('showToast', '下载失败：' + (p.error || ''));
    // [B-52] 释放槽位，拉起排队中的下一个
    _activeSet.delete(p.episodeId);
    _pump();
  });
}

export async function startDownload(episode) {
  if (!ipcRenderer) {
    store.dispatch('showToast', '下载仅在桌面版可用');
    return { ok: false };
  }
  if (!episode || !episode.audioUrl) {
    store.dispatch('showToast', '该单集没有音频地址');
    return { ok: false };
  }
  // 已下载就别重启
  const existing = await db.episodeDownloads.get(episode.id);
  if (existing && existing.status === 'done') {
    return { ok: true, alreadyDone: true };
  }
  // 已在下载/排队 → 忽略重复（多选批量时天然去重）
  if (_activeSet.has(episode.id) || _waitQueue.some(e => e.id === episode.id)) {
    return { ok: true, already: true };
  }
  // [B-52] 并发上限：达到上限则入队排队(status:'queued')，否则立即下载
  if (_activeSet.size >= MAX_CONCURRENT) {
    _waitQueue.push(episode);
    store.commit('setDownloadProgress', {
      episodeId: episode.id,
      bytesDone: 0,
      bytesTotal: 0,
      status: 'queued',
    });
    return { ok: true, queued: true };
  }
  _activeSet.add(episode.id);
  return _doStart(episode);
}

export async function cancelDownload(episodeId) {
  // [B-52] 排队中(未开始) → 直接出队，无需通知主进程
  const qi = _waitQueue.findIndex(e => e.id === episodeId);
  if (qi >= 0) {
    _waitQueue.splice(qi, 1);
    store.commit('clearDownloadProgress', episodeId);
    return { ok: true };
  }
  if (!ipcRenderer) return { ok: false };
  const res = await ipcRenderer.invoke('podcast:download:cancel', {
    episodeId,
  });
  _activeSet.delete(episodeId);
  store.commit('clearDownloadProgress', episodeId);
  _pump();
  return res || { ok: false };
}

export async function removeDownload(episodeId) {
  const row = await db.episodeDownloads.get(episodeId);
  if (!row) return { ok: true };
  if (ipcRenderer && row.filePath) {
    await ipcRenderer.invoke('podcast:download:remove', {
      filePath: row.filePath,
    });
  }
  await db.episodeDownloads.delete(episodeId);
  store.commit('removeDownloadedEpisode', episodeId);
  return { ok: true };
}

export async function loadAllDownloads() {
  return await db.episodeDownloads.toArray();
}

export async function getDownload(episodeId) {
  return await db.episodeDownloads.get(episodeId);
}

// [B-33/B-35] 我的下载页：已下载单集富对象（join 元数据），按下载时间**正序**（最早在上、最新在下）
export async function getDownloadedEpisodes() {
  const rows = await db.episodeDownloads.toArray();
  const done = rows.filter(r => r && r.status === 'done');
  const result = [];
  for (const r of done) {
    const ep = await db.episodes.get(r.id);
    if (!ep) continue;
    let podcastTitle = '';
    try {
      const pod = await db.podcasts.get(ep.podcastId);
      podcastTitle = (pod && pod.title) || '';
    } catch (e) {
      // ignore
    }
    result.push({
      ...ep,
      podcastTitle,
      filePath: r.filePath,
      downloadedAt: r.addedAt || 0,
    });
  }
  result.sort((a, b) => (a.downloadedAt || 0) - (b.downloadedAt || 0));
  return result;
}

// [B-35] 正在下载的单集富对象（从 store.progressMap 取 downloading 的 id + join 元数据）
export async function getDownloadingEpisodes() {
  const pm =
    (store.state.podcastDownloads &&
      store.state.podcastDownloads.progressMap) ||
    {};
  const ids = Object.keys(pm).filter(
    id => pm[id] && pm[id].status === 'downloading'
  );
  const result = [];
  for (const id of ids) {
    const ep = await db.episodes.get(id);
    if (!ep) continue;
    let podcastTitle = '';
    try {
      const pod = await db.podcasts.get(ep.podcastId);
      podcastTitle = (pod && pod.title) || '';
    } catch (e) {
      // ignore
    }
    result.push({ ...ep, podcastTitle });
  }
  return result;
}
