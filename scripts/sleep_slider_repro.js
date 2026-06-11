/* 睡眠滑条逻辑级复现：jsdom + 真实 vue-slider-component@3.2.24 + Player.vue 原版睡眠逻辑
 * 几何打桩：rail offsetWidth=216, rail 左缘 pageX=100 → 像素↔值 映射完全可控
 */
const { JSDOM } = require('jsdom');
const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="app"></div></body></html>',
  {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  }
);
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.getComputedStyle = dom.window.getComputedStyle;
global.MouseEvent = dom.window.MouseEvent;
global.Event = dom.window.Event;
global.requestAnimationFrame = cb => setTimeout(cb, 0);
global.cancelAnimationFrame = id => clearTimeout(id);

const PROJ = require('path').resolve(__dirname, '..');
const Vue = require(PROJ + '/node_modules/vue/dist/vue.common.dev.js');
const VueSlider = require(PROJ +
  '/node_modules/vue-slider-component/dist/vue-slider-component.common.js');
Vue.config.productionTip = false;
Vue.config.devtools = false;

// ---- 几何打桩 ----
const RAIL_W = 216; // 拆行后滑轨恒宽
const RAIL_LEFT = 100; // rail 在页面上的左缘
function stubRail(vm) {
  const rail = vm.$el.querySelector('.vue-slider-rail');
  Object.defineProperty(rail, 'offsetWidth', {
    get: () => RAIL_W,
    configurable: true,
  });
  rail.getBoundingClientRect = () => ({
    left: RAIL_LEFT,
    top: 0,
    right: RAIL_LEFT + RAIL_W,
    bottom: 8,
    width: RAIL_W,
    height: 8,
  });
  // vue-slider 根元素 $el 也可能被用到
  const root = vm.$el.querySelector('.vue-slider');
  Object.defineProperty(root, 'offsetWidth', {
    get: () => RAIL_W,
    configurable: true,
  });
  root.getBoundingClientRect = () => ({
    left: RAIL_LEFT,
    top: 0,
    right: RAIL_LEFT + RAIL_W,
    bottom: 22,
    width: RAIL_W,
    height: 22,
  });
}

// ---- 从 Player.vue 原样复制的睡眠逻辑（数据+方法，去掉 UI 无关部分）----
const fakePlayer = {
  currentTrackDuration: 0,
  progress: 0,
  playing: true,
  pause() {
    this.playing = false;
  },
};

const app = new Vue({
  el: '#app',
  components: { VueSlider },
  template: `
    <div class="sl-track">
      <vue-slider
        ref="slider"
        :value="sleepSliderVal"
        :min="0"
        :max="sleepMaxMin"
        :interval="sleepStep"
        :height="8"
        :drag-on-click="true"
        :duration="0"
        tooltip="none"
        :dot-size="14"
        @change="onSleepChange"
        @drag-end="onSleepCommit"
      ></vue-slider>
    </div>`,
  data() {
    return {
      player: fakePlayer,
      sleepMode: 'off',
      sleepTimer: null,
      sleepInterval: null,
      sleepEndsAt: 0,
      sleepRemainText: '',
      sleepSliderVal: 0,
      sleepMaxMin: 120,
      sleepStep: 5,
      sleepEndStop: 0,
      sleepDragging: false,
      sleepMarkerPct: null,
      sleepEpisodeRemainMin: 0,
      log: [],
    };
  },
  methods: {
    computeSleepRange() {
      const dur = this.player.currentTrackDuration || 0;
      const pos = this.player.progress || 0;
      const remainMin = (dur - pos) / 60;
      if (dur > 0 && remainMin >= 1) {
        this.sleepEpisodeRemainMin = remainMin;
        const step = this.sleepStepFor(remainMin);
        const endStop = Math.max(step, Math.ceil(remainMin / step) * step);
        // [B-69bis S0-spec] CAP=120/按剩余：剩余<120→max=120(轴稳定)、蓝标按真实剩余比例；≥120→max=endStop
        const CAP = 120;
        const max = remainMin >= CAP ? endStop : Math.ceil(CAP / step) * step;
        this.sleepStep = step;
        this.sleepEndStop = endStop;
        this.sleepMaxMin = max;
        this.sleepMarkerPct = Math.min(100, (endStop / max) * 100);
        // [B-69bis S2] end 重开贴蓝标；min 就近规整
        if (this.sleepMode === 'end') this.sleepSliderVal = endStop;
        else if (this.sleepMode === 'min')
          this.sleepSliderVal = Math.min(
            max,
            Math.round(this.sleepSliderVal / step) * step
          );
      } else {
        this.sleepEpisodeRemainMin = 0;
        this.sleepStep = 5;
        this.sleepEndStop = 0;
        this.sleepMaxMin = 120;
        this.sleepMarkerPct = null;
      }
    },
    onSleepChange(val) {
      this.sleepDragging = true;
      this.sleepSliderVal = Math.max(0, Math.round(Number(val) || 0));
      this.log.push(['change', val]);
    },
    onSleepCommit() {
      this.sleepDragging = false;
      const min = this.sleepSliderVal;
      this.log.push(['commit', min]);
      if (min <= 0) {
        this.cancelSleep();
        return;
      }
      if (
        this.sleepMarkerPct != null &&
        this.sleepEpisodeRemainMin > 0 &&
        min === this.sleepEndStop
      ) {
        this.applySleep(0, 'end');
        return;
      }
      this.applySleep(min * 60 * 1000, 'min');
    },
    sleepStepFor(min) {
      if (min <= 30) return 1;
      if (min <= 60) return 2;
      if (min <= 120) return 5;
      if (min <= 240) return 10;
      return 15;
    },
    applySleep(ms, mode) {
      this.clearSleep();
      this.sleepMode = mode;
      if (mode === 'min') this.sleepEndsAt = Date.now() + ms;
      else this.sleepEndsAt = 0;
    },
    cancelSleep() {
      this.clearSleep();
      this.sleepMode = 'off';
      this.sleepRemainText = '';
      this.sleepSliderVal = 0;
    },
    clearSleep() {},
  },
});

// ---- 事件驱动工具 ----
function fire(target, type, pageX) {
  const ev = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: pageX,
    clientY: 4,
  });
  Object.defineProperty(ev, 'pageX', { get: () => pageX });
  Object.defineProperty(ev, 'pageY', { get: () => 4 });
  target.dispatchEvent(ev);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pxForValue(v) {
  return RAIL_LEFT + (v / app.sleepMaxMin) * RAIL_W;
} // 期望：值 v 应在的像素
function valueAtPx(px) {
  return ((px - RAIL_LEFT) / RAIL_W) * app.sleepMaxMin;
} // 期望：像素处对应的值

async function dragRail(fromPx, toPx, steps = 8) {
  const sliderRoot = app.$el.querySelector('.vue-slider');
  fire(sliderRoot, 'mousedown', fromPx);
  await sleep(5);
  for (let i = 1; i <= steps; i++) {
    fire(document, 'mousemove', fromPx + ((toPx - fromPx) * i) / steps);
    await sleep(2);
  }
  fire(document, 'mouseup', toPx);
  await sleep(30); // dragEnd 的 setTimeout
}

async function scenario(name, durMin, posMin, fn) {
  fakePlayer.currentTrackDuration = durMin * 60;
  fakePlayer.progress = posMin * 60;
  app.sleepMode = 'off';
  app.sleepSliderVal = 0;
  app.log = [];
  app.computeSleepRange();
  await app.$nextTick();
  stubRail(app);
  console.log(
    `\n===== ${name} | 总长${durMin}min 已播${posMin}min 剩余${
      durMin - posMin
    }min =====`
  );
  console.log(
    `  量程: max=${app.sleepMaxMin} step=${app.sleepStep} endStop=${
      app.sleepEndStop
    } markerPct=${app.sleepMarkerPct && app.sleepMarkerPct.toFixed(1)}%`
  );
  await fn();
}

(async () => {
  await app.$nextTick();
  stubRail(app);

  // ---- 场景1：短单集（剩余25min）首次拖动 → 拖到轨道 50% 处 ----
  await scenario('S1 短单集首拖', 30, 5, async () => {
    const target = RAIL_LEFT + RAIL_W * 0.5;
    await dragRail(RAIL_LEFT + 5, target);
    console.log(
      `  拖到 50%(${target}px) 期望值≈${valueAtPx(target).toFixed(
        1
      )} | 实际 sleepSliderVal=${app.sleepSliderVal} mode=${app.sleepMode}`
    );
    console.log(`  事件日志: ${JSON.stringify(app.log)}`);
    const internal = app.$refs.slider.getValue();
    console.log(
      `  slider 内部值=${internal} | 把手应在 ${pxForValue(
        app.sleepSliderVal
      ).toFixed(0)}px`
    );
  });

  // ---- 场景2：短单集 拖到蓝标(endStop) → 应进 end 模式 ----
  await scenario('S2 短单集拖到蓝标', 30, 5, async () => {
    const target = RAIL_LEFT + RAIL_W * (app.sleepMarkerPct / 100);
    await dragRail(RAIL_LEFT + 5, target);
    console.log(
      `  拖到蓝标(${target.toFixed(0)}px, ${app.sleepMarkerPct.toFixed(
        1
      )}%) | sleepSliderVal=${app.sleepSliderVal} endStop=${
        app.sleepEndStop
      } mode=${app.sleepMode}`
    );
  });

  // ---- 场景3：长单集（剩余264min）首拖到 30% ----
  await scenario('S3 长单集首拖', 270, 6, async () => {
    const target = RAIL_LEFT + RAIL_W * 0.3;
    await dragRail(RAIL_LEFT + 5, target);
    console.log(
      `  拖到 30%(${target}px) 期望值≈${valueAtPx(target).toFixed(1)} | 实际=${
        app.sleepSliderVal
      } mode=${app.sleepMode}`
    );
    console.log(`  事件日志: ${JSON.stringify(app.log)}`);
  });

  // ---- 场景4：长单集拖到最右(=endStop=max) → 应 end 模式 ----
  await scenario('S4 长单集拖到最右', 270, 6, async () => {
    await dragRail(RAIL_LEFT + 5, RAIL_LEFT + RAIL_W - 1);
    console.log(
      `  拖到最右 | sleepSliderVal=${app.sleepSliderVal} endStop=${app.sleepEndStop} mode=${app.sleepMode}`
    );
  });

  // ---- 场景5：已设定时(min模式40)后再次拖动（S1修复后这条应正常）----
  await scenario('S5 已设定时再拖', 270, 6, async () => {
    app.sleepSliderVal = 60;
    app.onSleepCommit();
    app.log = [];
    await app.$nextTick();
    const target = RAIL_LEFT + RAIL_W * 0.7;
    await dragRail(pxForValue(60), target);
    console.log(
      `  从60拖到70%(期望≈${valueAtPx(target).toFixed(1)}) | 实际=${
        app.sleepSliderVal
      } mode=${app.sleepMode}`
    );
  });

  // ---- 场景6：点击轨道(不拖) drag-on-click ----
  await scenario('S6 点击轨道', 30, 5, async () => {
    const target = RAIL_LEFT + RAIL_W * 0.25;
    const sliderRoot = app.$el.querySelector('.vue-slider');
    fire(sliderRoot, 'mousedown', target);
    await sleep(5);
    fire(document, 'mouseup', target);
    await sleep(30);
    fire(sliderRoot, 'click', target);
    await sleep(30);
    console.log(
      `  点击 25%(期望≈${valueAtPx(target).toFixed(1)}) | 实际=${
        app.sleepSliderVal
      } mode=${app.sleepMode} 日志=${JSON.stringify(app.log)}`
    );
  });

  // ---- 场景7：把手(dot)上按下拖动 ----
  await scenario('S7 拖把手', 30, 5, async () => {
    app.sleepSliderVal = 10;
    app.sleepMode = 'min';
    await app.$nextTick();
    const dot = app.$el.querySelector('.vue-slider-dot');
    const from = pxForValue(10),
      to = RAIL_LEFT + RAIL_W * 0.75;
    fire(dot, 'mousedown', from);
    await sleep(5);
    for (let i = 1; i <= 6; i++) {
      fire(document, 'mousemove', from + ((to - from) * i) / 6);
      await sleep(2);
    }
    fire(document, 'mouseup', to);
    await sleep(30);
    console.log(
      `  把手从10拖到75%(期望≈${valueAtPx(to).toFixed(1)}) | 实际=${
        app.sleepSliderVal
      } mode=${app.sleepMode}`
    );
  });

  // ---- 场景8：边界——剩余91min（>90 切换点）----
  await scenario('S8 剩余91min 边界', 100, 9, async () => {
    const target = RAIL_LEFT + RAIL_W * 0.5;
    await dragRail(RAIL_LEFT + 5, target);
    console.log(
      `  拖到50%(期望≈${valueAtPx(target).toFixed(1)}) | 实际=${
        app.sleepSliderVal
      } mode=${app.sleepMode}`
    );
  });

  process.exit(0);
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
