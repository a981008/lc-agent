<script setup>
import { ref, watch, nextTick } from 'vue';
import { store } from '../store.js';

const box = ref(null);

// 新日志到达后滚动到底部
watch(
  () => store.logs.length,
  async () => {
    await nextTick();
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  }
);
</script>

<template>
  <div ref="box" class="log">
    <div v-for="l in store.logs" :key="l.id" :class="l.level">{{ l.text }}</div>
  </div>
</template>
