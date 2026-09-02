<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store.js';

const STATE_TEXT = {
  IDLE: '⚪ IDLE', RUNNING: '🟢 RUNNING', COOLING: '🟡 COOLING',
  IN_PROGRESS: '🟣 IN_PROGRESS', PAUSED: '🟡 PAUSED', BLOCKED: '🔴 BLOCKED',
};

const stateText = computed(() => (store.status ? (STATE_TEXT[store.status.state] || store.status.state) : '—'));
const cookieText = computed(() => {
  const c = store.status?.cookie;
  if (!c?.configured) return '未配置';
  return c.status === 'Authenticated' ? '✅ 有效' : c.status ?? '未探针';
});

/* 冷却倒计时：以服务端下发的 cooldownEndsAt 为锚，本地每秒刷新（m:ss） */
const now = ref(Date.now());
let timer = null;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null; } });

const cdLeftMs = computed(() => {
  const endsAt = store.status?.cooldownEndsAt;
  if (!endsAt) return 0;
  return Math.max(0, Number(endsAt) - now.value);
});
const cdText = computed(() => {
  const s = Math.ceil(cdLeftMs.value / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
});
</script>

<template>
  <header v-if="store.status" class="topbar">
    <span class="brand">🤖 lc-agent</span>
    <span :class="['chip', store.status.state]">{{ stateText }}</span>
    <span :class="['chip', store.status.cookie.status === 'Authenticated' ? '' : 'muted']">Cookie: {{ cookieText }}</span>
    <span class="chip muted">AC: {{ store.status.counts.accepted }}/{{ store.status.counts.total }}（跳过 {{ store.status.counts.skipped }}）</span>
    <span class="chip muted">LLM 预算: {{ store.status.budget.usagePct }}%（{{ store.status.budget.calls }} 次）</span>
    <span v-if="cdLeftMs > 0" class="chip cooling">⏳ 冷却 {{ cdText }}</span>
    <span class="spacer"></span>
    <span :class="['chip', store.conn.muted ? 'muted' : '']">{{ store.conn.text }}</span>
  </header>
</template>
