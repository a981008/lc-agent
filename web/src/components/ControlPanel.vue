<script setup>
import { store, actions } from '../store.js';
import StrategyForm from './StrategyForm.vue';
import CredentialsForm from './CredentialsForm.vue';
import LlmForm from './LlmForm.vue';
import LimitsForm from './LimitsForm.vue';
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

    <StrategyForm />
    <CredentialsForm />
    <LlmForm />
    <LimitsForm />
  </section>
</template>
