<script setup>
import { store } from '../store.js';

function close() {
  store.modal.open = false;
}

// 页签事件委托：v-html 内的按钮无法绑 Vue 事件，这里统一代理
function onMdClick(e) {
  const btn = e.target.closest('.ac-tab');
  if (!btn) return;
  const group = btn.closest('.ac-tabs');
  if (!group) return;
  const idx = btn.dataset.tab;
  group.querySelectorAll('.ac-tab').forEach((b) => b.classList.toggle('active', b === btn));
  group.querySelectorAll('.ac-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === idx));
}
</script>

<template>
  <div v-if="store.modal.open" class="modal" @click.self="close">
    <div class="modal-card">
      <button class="close" @click="close">✕</button>
      <div v-if="store.modal.kind === 'solution'" class="md" v-html="store.modal.html" @click="onMdClick"></div>
      <pre v-else class="attempts-pre">{{ store.modal.text }}</pre>
    </div>
  </div>
</template>
