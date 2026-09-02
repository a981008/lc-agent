<script setup>
import { store, actions } from '../store.js';
import StrategyForm from './StrategyForm.vue';
import CredentialsForm from './CredentialsForm.vue';
import LlmForm from './LlmForm.vue';
import LimitsForm from './LimitsForm.vue';

const CONFIG_TABS = [
  { key: 'strategy', label: '策略' },
  { key: 'credentials', label: '凭据' },
  { key: 'llm', label: 'LLM' },
  { key: 'limits', label: '参数' },
];
</script>

<template>
  <section class="panel panel-controls">
    <h3>控制</h3>
    <div class="btn-row">
      <button class="primary" @click="actions.doResume">▶ 恢复</button>
      <button @click="actions.doPause">⏸ 暂停</button>
      <button @click="actions.doTrigger">⚡ 跑单题</button>
      <button class="danger" @click="actions.doHalt">⏹ 终止</button>
    </div>
    <div class="field">
      <label>指定 slug（跑单题可选）</label>
      <input v-model="store.forms.manualSlug" placeholder="如 two-sum" />
    </div>

    <div class="tabs config-tabs">
      <button
        v-for="t in CONFIG_TABS"
        :key="t.key"
        class="tab"
        :class="{ active: store.configTab === t.key }"
        @click="actions.setConfigTab(t.key)"
      >{{ t.label }}</button>
    </div>

    <div v-show="store.configTab === 'strategy'"><StrategyForm /></div>
    <div v-show="store.configTab === 'credentials'"><CredentialsForm /></div>
    <div v-show="store.configTab === 'llm'"><LlmForm /></div>
    <div v-show="store.configTab === 'limits'"><LimitsForm /></div>
  </section>
</template>
