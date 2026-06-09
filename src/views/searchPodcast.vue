<template>
  <!-- [B-52] 播客搜索结果页：本地（我的订阅/单集）+ 在线发现（iTunes） -->
  <div class="search-podcast">
    <h1 class="sp-title">搜索 “{{ keywords }}”</h1>

    <!-- 本地：已订阅节目 -->
    <section v-if="localPods.length" class="sp-section">
      <div class="sp-head">我的订阅</div>
      <div class="sp-grid">
        <div
          v-for="p in localPods"
          :key="p.id"
          class="local-card"
          @click="openLocalPodcast(p)"
        >
          <div class="lc-cover-box">
            <div
              class="lc-shadow"
              :style="{ backgroundImage: `url(${p.coverUrl})` }"
            ></div>
            <img class="lc-cover" :src="p.coverUrl" @error="onImgErr" />
          </div>
          <div class="lc-name">{{ p.title }}</div>
        </div>
      </div>
    </section>

    <!-- 本地：单集标题 -->
    <section v-if="localEps.length" class="sp-section">
      <div class="sp-head">单集</div>
      <div class="ep-list">
        <div
          v-for="ep in localEps"
          :key="ep.id"
          class="ep-row"
          @click="playEpisode(ep)"
        >
          <svg-icon icon-class="play-circle" class="ep-play" />
          <div class="ep-meta">
            <div class="ep-t">{{ ep.title }}</div>
            <div class="ep-s">{{ ep.podcastTitle }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 在线发现 -->
    <section class="sp-section">
      <div class="sp-head">在线发现</div>
      <div v-if="loadingOnline" class="sp-state">正在搜索在线播客…</div>
      <div v-else-if="errorOnline" class="sp-state">{{ errorOnline }}</div>
      <div v-else-if="!onlineItems.length" class="sp-state">
        没有找到相关播客
      </div>
      <div v-else class="sp-grid">
        <DiscoverCard v-for="p in onlineItems" :key="p.id" :podcast="p" />
      </div>
    </section>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import { searchPodcasts } from '@/utils/podcast/discover';
import { searchLocalPodcasts, searchLocalEpisodes } from '@/utils/podcast/db';
import DiscoverCard from '@/components/DiscoverCard.vue';
import SvgIcon from '@/components/SvgIcon.vue';

export default {
  name: 'SearchPodcast',
  components: { DiscoverCard, SvgIcon },
  data() {
    return {
      localPods: [],
      localEps: [],
      onlineItems: [],
      loadingOnline: false,
      errorOnline: '',
    };
  },
  computed: {
    ...mapState(['player']),
    keywords() {
      return this.$route.params.keywords || '';
    },
  },
  watch: {
    keywords: {
      immediate: true,
      handler() {
        this.doSearch();
      },
    },
  },
  methods: {
    async doSearch() {
      const kw = this.keywords;
      if (!kw) return;
      // 本地（快）：已订阅节目 + 单集标题
      try {
        const [pods, eps] = await Promise.all([
          searchLocalPodcasts(kw).catch(() => []),
          searchLocalEpisodes(kw).catch(() => []),
        ]);
        this.localPods = pods;
        this.localEps = eps;
      } catch (e) {
        this.localPods = [];
        this.localEps = [];
      }
      // 在线（慢）：iTunes Search
      this.loadingOnline = true;
      this.errorOnline = '';
      this.onlineItems = [];
      try {
        this.onlineItems = await searchPodcasts(kw);
      } catch (e) {
        this.errorOnline = '在线搜索失败：' + ((e && e.message) || e);
      } finally {
        this.loadingOnline = false;
      }
    },
    openLocalPodcast(p) {
      this.$router.push({
        name: 'podcastDetail',
        params: { feedUrlEncoded: encodeURIComponent(p.id) },
      });
    },
    playEpisode(ep) {
      if (this.player && this.player.playPodcastEpisode) {
        this.player.playPodcastEpisode(ep, ep.podcastTitle);
      }
    },
    onImgErr(e) {
      e.target.style.opacity = 0.15;
    },
  },
};
</script>

<style lang="scss" scoped>
.search-podcast {
  color: var(--color-text);
  padding-top: 28px;
  animation: spEnter 0.3s ease;
}
@keyframes spEnter {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.sp-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 24px;
}
.sp-section {
  margin-bottom: 32px;
}
.sp-head {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 14px;
  opacity: 0.85;
}
.sp-state {
  opacity: 0.5;
  font-size: 14px;
  padding: 24px 0;
}
.sp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 24px;
}
// 本地已订阅卡片（含虚化光晕，与发现页一致观感）
.local-card {
  cursor: pointer;
  &:hover .lc-cover-box {
    transform: translateY(-4px) scale(1.02);
  }
  .lc-cover-box {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    transition: transform 0.25s;
  }
  .lc-shadow {
    position: absolute;
    left: 0;
    top: 12px;
    width: 100%;
    height: 100%;
    border-radius: 12px;
    background-size: cover;
    background-position: center;
    filter: blur(16px) opacity(0.45);
    transform: scale(0.92);
    z-index: 0;
  }
  .lc-cover {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 12px;
    object-fit: cover;
    background: var(--color-secondary-bg);
    z-index: 1;
  }
  .lc-name {
    margin-top: 10px;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
// 单集行
.ep-list {
  border-top: 1px solid var(--color-secondary-bg);
}
.ep-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--color-secondary-bg);
  cursor: pointer;
  transition: 0.15s;
  &:hover {
    background: var(--color-secondary-bg-for-transparent);
    padding-left: 10px;
  }
  .ep-play {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: var(--color-primary);
  }
  .ep-meta {
    overflow: hidden;
  }
  .ep-t {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ep-s {
    font-size: 12px;
    opacity: 0.55;
    margin-top: 2px;
  }
}
</style>
