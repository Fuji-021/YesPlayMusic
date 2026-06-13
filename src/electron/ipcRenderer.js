import store from '@/store';

const player = store.state.player;

export function ipcRenderer(vueInstance) {
  const self = vueInstance;
  // 添加专有的类名
  document.body.setAttribute('data-electron', 'yes');
  document.body.setAttribute(
    'data-electron-os',
    window.require('os').platform()
  );
  // ipc message channel
  const electron = window.require('electron');
  const ipcRenderer = electron.ipcRenderer;

  // listens to the main process 'changeRouteTo' event and changes the route from
  // inside this Vue instance, according to what path the main process requires.
  // responds to Menu click() events at the main process and changes the route accordingly.

  ipcRenderer.on('changeRouteTo', (event, path) => {
    self.$router.push(path);
    if (store.state.showLyrics) {
      store.commit('toggleLyrics');
    }
  });

  ipcRenderer.on('search', () => {
    // 触发数据响应
    self.$refs.navbar.$refs.searchInput.focus();
    self.$refs.navbar.inputFocus = true;
  });

  ipcRenderer.on('play', () => {
    player.playOrPause();
  });

  // [播客快捷键] 下一首/上一首对播客无意义(队列导航空操作)→ 改为快进 30 秒 / 快退 15 秒，
  //   与底栏 ±15/30 按钮一致(Player.vue seekForward30 / seekBackward15)。
  ipcRenderer.on('next', () => {
    const cur = player.seek();
    const dur = player.currentTrackDuration || 0;
    player.seek(Math.min(Math.max(0, dur - 1), (cur || 0) + 30));
  });

  ipcRenderer.on('previous', () => {
    const cur = player.seek();
    player.seek(Math.max(0, (cur || 0) - 15));
  });

  ipcRenderer.on('increaseVolume', () => {
    if (player.volume + 0.1 >= 1) {
      return (player.volume = 1);
    }
    player.volume += 0.1;
  });

  ipcRenderer.on('decreaseVolume', () => {
    if (player.volume - 0.1 <= 0) {
      return (player.volume = 0);
    }
    player.volume -= 0.1;
  });

  // [播客快捷键] 收藏：播客单集 → 本地收藏切换；网易云曲 → 原 likeATrack(同 Player.vue toggleFavorite)。
  ipcRenderer.on('like', () => {
    const t = player.currentTrack;
    if (!t) return;
    if (t.podcastEpisodeId) {
      store.dispatch('togglePodcastFavorite', t);
    } else if (t.id) {
      store.dispatch('likeATrack', t.id);
    }
  });

  ipcRenderer.on('repeat', () => {
    player.switchRepeatMode();
  });

  ipcRenderer.on('shuffle', () => {
    player.switchShuffle();
  });

  ipcRenderer.on('routerGo', (event, where) => {
    self.$refs.navbar.go(where);
  });

  ipcRenderer.on('nextUp', () => {
    self.$refs.player.goToNextTracksPage();
  });

  ipcRenderer.on('rememberCloseAppOption', (event, value) => {
    store.commit('updateSettings', {
      key: 'closeAppOption',
      value,
    });
  });

  ipcRenderer.on('setPosition', (event, position) => {
    player._howler.seek(position);
  });
}
