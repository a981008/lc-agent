<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { store } from '../store.js';

const box = ref(null);
const PAGE = 150;           // 每页条数
const windowSize = ref(PAGE); // 当前渲染窗口（从尾部计数）
const follow = ref(true);     // 跟随最新：新日志自动滚底

const total = computed(() => store.logs.length);
const visible = computed(() => store.logs.slice(Math.max(0, total.value - windowSize.value)));
const hasOlder = computed(() => total.value > windowSize.value);

function loadOlder() {
  follow.value = false;
  const el = box.value;
  const prevHeight = el?.scrollHeight ?? 0;
  const prevTop = el?.scrollTop ?? 0;
  windowSize.value = Math.min(total.value, windowSize.value + PAGE);
  // prepend 后保持视口停在原内容位置，不跳动
  nextTick(() => {
    if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
  });
}

function jumpToLatest() {
  follow.value = true;
  windowSize.value = PAGE;
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  });
}

// 新日志：仅跟随模式滚底；窗口语义天然滑向最新，无需额外处理
watch(
  () => store.logs.length,
  async () => {
    if (!follow.value) return;
    await nextTick();
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  }
);
</script>

<template>
  <div class="log-wrap">
    <div v-if="hasOlder || !follow" class="log-pager">
      <button v-if="hasOlder" class="f-btn" @click="loadOlder">↑ 加载更早 {{ Math.min(PAGE, total - windowSize) }} 条</button>
      <button v-if="!follow" class="f-btn" @click="jumpToLatest">↓ 回到最新</button>
      <span class="hint">显示 {{ visible.length }} / {{ total }} 条</span>
    </div>
    <div ref="box" class="log">
      <div v-for="l in visible" :key="l.id" :class="l.level">{{ l.text }}</div>
    </div>
  </div>
</template>
