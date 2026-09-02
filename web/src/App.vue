<script setup>
import { onMounted, onUnmounted } from 'vue';
import { store, actions } from './store.js';
import TokenGate from './components/TokenGate.vue';
import TopBar from './components/TopBar.vue';
import ControlPanel from './components/ControlPanel.vue';
import PipelineView from './components/PipelineView.vue';
import HistoryPanel from './components/HistoryPanel.vue';
import AppModal from './components/AppModal.vue';

function onUnauthorized() {
  actions.logout('Token 无效，请重新输入');
}

onMounted(() => window.addEventListener('lc:unauthorized', onUnauthorized));
onUnmounted(() => window.removeEventListener('lc:unauthorized', onUnauthorized));
</script>

<template>
  <TokenGate v-if="!store.authed" />

  <template v-else>
    <TopBar />

    <main class="grid">
      <ControlPanel />
      <PipelineView />
    </main>

    <HistoryPanel />

    <AppModal />
  </template>
</template>
