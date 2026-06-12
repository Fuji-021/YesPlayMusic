/* 统计页 v1.5.4（黄金版）toggle 残留实验
 * 真实 Vue 2.7 transition-group + statsPage v1.5.4 原版逻辑（loadRange/setRange/animateTo/enterWithAnimation 原样复制）
 * 变量：L = getListenStatsByPodcast 取数延迟(ms)；T = 来回点击间隔(ms)
 * 采样：每 20ms 记录 DOM 中实际存在的行（差集节目 = 只在"全部"不在"周"的节目）
 */
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true, url: 'http://localhost/',
});
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = cb => setTimeout(cb, 16);
global.cancelAnimationFrame = id => clearTimeout(id);

const PROJ = require('path').resolve(__dirname, '..');
const Vue = require(PROJ + '/node_modules/vue/dist/vue.common.dev.js');
Vue.config.productionTip = false; Vue.config.devtools = false;

// ---- 数据：仿测试床 12 档全部 / 5 档周（7 档差集） ----
const ALL = []; for (let i = 1; i <= 12; i++) ALL.push({ podcastId: 'P' + String(i).padStart(2, '0'), title: '节目' + i, coverUrl: '', wallSec: (13 - i) * 36000 });
const WEEK_IDS = ['P03', 'P05', 'P01', 'P08', 'P11']; // 周榜 5 档（顺序与全部不同 → 触发 FLIP 重排）
const WEEK = WEEK_IDS.map((id, i) => ({ ...ALL.find(x => x.podcastId === id), wallSec: (9 - i) * 3600 }));
const ALL_ONLY = ALL.filter(x => !WEEK_IDS.includes(x.podcastId)).map(x => x.podcastId); // 7 档差集

let FETCH_LATENCY = 80; let fetchCount = 0;
function fakeGetStats(range) {
  fetchCount++;
  const list = (range === 'week' || range === 7) ? WEEK : ALL;
  return new Promise(res => setTimeout(() => res({ totalWall: list.reduce((s, x) => s + x.wallSec, 0), list: list.map(x => ({ ...x })) }), FETCH_LATENCY));
}

let appliedCount = 0; // animateTo 实际提交次数

// ---- v1.5.4 组件（逻辑原样复制自 statsPage.vue@HEAD，仅 数据源/快照存取 改为可注入） ----
const app = new Vue({
  el: '#app',
  template: `
    <div>
      <transition-group name="stat" tag="div" class="stat-list">
        <div v-for="item in visibleList" :key="item.podcastId" class="stat-row" :data-pid="item.podcastId">
          <div class="bar" :style="{ width: item._w + '%' }"></div>
          <div class="label">{{ item.title }}</div>
        </div>
      </transition-group>
    </div>`,
  data() { return { range: 'all', totalWall: 0, rangeTotal: 0, list: [], loaded: false }; },
  computed: {
    visibleList() { return this.list; }, // blockedNames 为空集，等价
    animK() { return 2; }, // Dev 测试床 0.5x
  },
  methods: {
    async loadTotal() { const { totalWall } = await fakeGetStats('all'); this.totalWall = totalWall; },
    // === 原版 loadRange ===
    async loadRange() {
      const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
      const range = this.range;
      const { totalWall, list } = await fakeGetStats(range === 'week' ? 7 : 'all');
      if (seq !== this._loadSeq) return; // ← seq 守卫：过期丢弃
      this.rangeTotal = totalWall;
      this.animateTo(list);
      this.saveSnapshot(range, list);
    },
    // === 原版 enterWithAnimation (v1.5.4：先 fresh 再建列表，快照仅作起点宽) ===
    async enterWithAnimation() {
      const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
      const range = this.range;
      await this.loadTotal();
      if (seq !== this._loadSeq) return;
      const fresh = await fakeGetStats(range === 'week' ? 7 : 'all');
      if (seq !== this._loadSeq) return;
      this.rangeTotal = fresh.totalWall;
      const snap = this.loadSnapshot(range) || [];
      const sMax = snap.length ? snap[0].wallSec || 1 : 1;
      const startW = {};
      snap.forEach(s => { startW[s.podcastId] = this.barTargetPct(s, sMax); });
      const maxWall = fresh.list.length ? fresh.list[0].wallSec : 1;
      const next = fresh.list.map(it => ({ ...it, _target: this.barTargetPct(it, maxWall), _w: startW[it.podcastId] != null ? startW[it.podcastId] : 0 }));
      this.list = next; this.loaded = true;
      this.$nextTick(() => { requestAnimationFrame(() => { requestAnimationFrame(() => { next.forEach(it => { it._w = it._target; }); }); }); });
      this.saveSnapshot(range, fresh.list);
    },
    barTargetPct(item, maxWall) { return Math.max(7, (item.wallSec / Math.max(1, maxWall)) * 60); },
    // === 原版 animateTo (v1.5.4) ===
    animateTo(freshList) {
      appliedCount++;
      const maxWall = freshList.length ? freshList[0].wallSec : 1;
      const prev = {}; this.list.forEach(it => { prev[it.podcastId] = it; });
      const next = freshList.map(it => { const p = prev[it.podcastId]; return { ...it, _target: this.barTargetPct(it, maxWall), _w: p ? p._w : 0, colorHsl: p ? p.colorHsl : undefined }; });
      this.list = next;
      this.$nextTick(() => { requestAnimationFrame(() => { requestAnimationFrame(() => { next.forEach(it => { it._w = it._target; }); }); }); });
    },
    loadSnapshot(range) { try { return JSON.parse(localStorage.getItem('snap.' + range) || '[]'); } catch (e) { return []; } },
    saveSnapshot(range, list) { try { localStorage.setItem('snap.' + range, JSON.stringify(list)); } catch (e) { /* */ } },
    // === 原版 setRange ===
    async setRange(r) {
      if (this.range === r) return;
      this.range = r;
      await this.loadRange();
    },
    // === 修复方案（与已提交 statsPage.vue@setRange 一字对齐：R9 采纳"过期请求也回填缓存"版）===
    async setRangeFixed(r) {
      if (this.range === r) return;
      this.range = r;
      const seq = (this._loadSeq = (this._loadSeq || 0) + 1);
      const cache = (this._rangeCache = this._rangeCache || {});
      const cached = cache[r];
      if (cached) { this.rangeTotal = cached.totalWall; this.animateTo(cached.list); } // ① 同步、零等待
      const fresh = await fakeGetStats(r === 'week' ? 7 : 'all');
      cache[r] = fresh; // ② 过期与否都回填缓存（即使冷缓存连点也能逐步填上，不再饥饿）
      if (seq !== this._loadSeq) return; // 被更晚切换接替 → 不提交本次
      if (!cached || JSON.stringify(fresh.list.map(x => [x.podcastId, x.wallSec])) !== JSON.stringify(cached.list.map(x => [x.podcastId, x.wallSec]))) {
        this.rangeTotal = fresh.totalWall; this.animateTo(fresh.list); // ③ 无缓存或数据真变才校正
      }
    },
    async warmCache() {
      const [w, a] = await Promise.all([fakeGetStats(7), fakeGetStats('all')]);
      this._rangeCache = { week: w, all: a };
    },
  },
});

// ---- 采样器 ----
const sleep = ms => new Promise(r => setTimeout(r, ms));
let samples = [];
let sampler = null;
function startSampling() {
  samples = [];
  const t0 = Date.now();
  sampler = setInterval(() => {
    const pids = [...document.querySelectorAll('.stat-row')].map(n => n.getAttribute('data-pid'));
    const wrong = pids.filter(p => ALL_ONLY.includes(p));
    samples.push({ t: Date.now() - t0, range: app.range, rows: pids.length, wrongCount: wrong.length });
  }, 20);
}
function stopSampling() { clearInterval(sampler); }
function report(name) {
  const weekSamples = samples.filter(s => s.range === 'week');
  const polluted = weekSamples.filter(s => s.wrongCount > 0);
  const pollutedMs = polluted.length * 20;
  const totalWeekMs = weekSamples.length * 20;
  console.log(`  [${name}] 周态采样 ${totalWeekMs}ms，其中差集节目在屏 ${pollutedMs}ms (${totalWeekMs ? Math.round((pollutedMs / totalWeekMs) * 100) : 0}%)；animateTo 提交 ${appliedCount} 次，fetch 发起 ${fetchCount} 次`);
  // 时间线压缩打印：wrongCount 变化点
  let last = null; const tl = [];
  samples.forEach(s => { const key = `${s.range}/${s.wrongCount}差集/${s.rows}行`; if (key !== last) { tl.push(`${s.t}ms→${key}`); last = key; } });
  console.log('  时间线: ' + tl.join(' | '));
}

(async () => {
  // 预置快照（模拟非首次进页）
  localStorage.setItem('snap.all', JSON.stringify(ALL));
  localStorage.setItem('snap.week', JSON.stringify(WEEK));

  // ============ S1：单次 全部→周，L=80ms ============
  FETCH_LATENCY = 80;
  await app.enterWithAnimation(); await sleep(300);
  appliedCount = 0; fetchCount = 0; startSampling();
  app.setRange('week');
  await sleep(800); stopSampling();
  console.log('\nS1 单次切换 全部→周 (L=80ms)：预期差集节目在"周态"残留 ≈L');
  report('S1');

  // ============ S2：来回快切 T=250ms × 8，L=80ms (L<T，每次都来得及应用) ============
  app.range = 'all'; await app.loadRange(); await sleep(300);
  appliedCount = 0; fetchCount = 0; startSampling();
  for (let i = 0; i < 8; i++) { app.setRange(i % 2 === 0 ? 'week' : 'all'); await sleep(250); }
  await sleep(600); stopSampling();
  console.log('\nS2 来回快切 T=250ms×8 (L=80ms<T)：预期每个周态窗口前 80ms 有差集，随后清掉');
  report('S2');

  // ============ S3：来回快切 T=250ms × 8，L=400ms (L>T，seq 守卫全程丢弃) ============
  FETCH_LATENCY = 400;
  app.range = 'all'; await app.loadRange(); await sleep(900);
  appliedCount = 0; fetchCount = 0; startSampling();
  for (let i = 0; i < 8; i++) { app.setRange(i % 2 === 0 ? 'week' : 'all'); await sleep(250); }
  await sleep(1200); stopSampling();
  console.log('\nS3 来回快切 T=250ms×8 (L=400ms>T)：预期连点期间 0 次提交、差集节目全程在屏=「一直存在」');
  report('S3');

  // ============ S4：修复方案（双范围缓存同步切换），同 S3 的恶劣条件 ============
  FETCH_LATENCY = 400;
  app.range = 'all'; await app.loadRange(); await sleep(900);
  await app.warmCache();
  appliedCount = 0; fetchCount = 0; startSampling();
  for (let i = 0; i < 8; i++) { app.setRangeFixed(i % 2 === 0 ? 'week' : 'all'); await sleep(250); }
  await sleep(1200); stopSampling();
  console.log('\nS4 修复版同 S3 条件 (缓存同步切换)：预期周态差集在屏 ≈0%');
  report('S4');

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
