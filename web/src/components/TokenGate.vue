<script setup>
import { store, actions } from '../store.js';
</script>

<template>
  <div class="gate">
    <div class="gate-card">
      <h2>lc-agent</h2>
      <p>请输入访问 Token（见服务器 data/dashboard-token.txt 或启动日志）</p>
      <input v-model="store.gateInput" type="password" placeholder="Dashboard Token" @keydown.enter="actions.submitToken" />
      <button @click="actions.submitToken">进入</button>
      <p class="err">{{ store.gateError }}</p>
    </div>
  </div>
</template>
