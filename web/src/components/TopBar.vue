<script setup>
import { computed } from 'vue';
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
</script>

<template>
  <header v-if="store.status" class="topbar">
    <span class="brand">🤖 lc-agent</span>
    <span :class="['chip', store.status.state]">{{ stateText }}</span>
    <span :class="['chip', store.status.cookie.status === 'Authenticated' ? '' : 'muted']">Cookie: {{ cookieText }}</span>
    <span class="chip muted">AC: {{ store.status.counts.accepted }}/{{ store.status.counts.total }}（跳过 {{ store.status.counts.skipped }}）</span>
    <span class="chip muted">LLM 预算: {{ store.status.budget.usagePct }}%（{{ store.status.budget.calls }} 次）</span>
    <span v-if="store.status.cooldownRemainingMs > 0" class="chip muted">⏳ 冷却 {{ Math.ceil(store.status.cooldownRemainingMs / 1000) }}s</span>
    <span class="spacer"></span>
    <span :class="['chip', store.conn.muted ? 'muted' : '']">{{ store.conn.text }}</span>
  </header>
</template>
