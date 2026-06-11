// [B-71/H1] 封面光晕(.cover-shadow blur(16px))的降采样底图。
//
// 背景：我的订阅页滚动卡顿排查（docs/BUG审查-B69… 追加 B-71）锁定头号成本——
//   订阅页光晕直接拿 RSS 原图(播客封面行业规范 ≥1400×1400、常见 3000×3000)做 blur(16px)，
//   而首页 DiscoverCard 用 hiResLogo(url,600) 封顶 600px；同样的 blur，订阅页每张卡的位图
//   解码 + 光栅化面积是首页的 5~25 倍，滚动重合成时这是两页体感差异的主因，且随订阅数增长恶化。
//
// 原理：blur(16px) 会抹掉一切比 16px 更细的细节 → 64px 的底图与 3000px 原图在该 blur 下视觉无差，
//   但解码/光栅成本降 ~99%。故把光晕底图统一降采样到 64px。
//
// 实现：用 <img> 解码 + canvas 缩到 64×64 + toDataURL。主窗口 webSecurity:false(background.js:205)
//   → canvas 跨域读回不会被污染、toDataURL 可用。失败(网络/极少数污染)回退原图：光晕照常显示、只是没省成本。
//
// 缓存：模块级 Map，按原始 url 去重；跨页面/重进订阅页复用，不重复计算。小图 dataURL(64px JPEG q0.7)
//   约 2~4KB，几十档累计 ~百 KB，可忽略；不用 objectURL 故无需手动 revoke。

const _cache = new Map(); // url -> tiny dataURL（失败则存原 url，避免重复尝试）
const _pending = new Map(); // url -> Promise<string>（在途去重）

const TINY_SIZE = 64;

// 同步窥探：命中返回小图 dataURL；未就绪返回 null（调用方可先用原图兜底）
export function peekTinyCover(url) {
  if (!url) return '';
  return _cache.has(url) ? _cache.get(url) : null;
}

// 异步保证：降采样并入缓存，resolve 小图 dataURL（任何失败均 resolve 原 url，绝不抛）
export function ensureTinyCover(url) {
  if (!url) return Promise.resolve('');
  if (_cache.has(url)) return Promise.resolve(_cache.get(url));
  if (_pending.has(url)) return _pending.get(url);

  const p = new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let out = url; // 兜底：默认回退原图
      try {
        const c = document.createElement('canvas');
        c.width = TINY_SIZE;
        c.height = TINY_SIZE;
        c.getContext('2d').drawImage(img, 0, 0, TINY_SIZE, TINY_SIZE);
        out = c.toDataURL('image/jpeg', 0.7);
      } catch (e) {
        out = url; // 理论上 webSecurity:false 不污染；万一污染就用原图
      }
      _cache.set(url, out);
      _pending.delete(url);
      resolve(out);
    };
    img.onerror = () => {
      _cache.set(url, url);
      _pending.delete(url);
      resolve(url);
    };
    img.src = url;
  });
  _pending.set(url, p);
  return p;
}
