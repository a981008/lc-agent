<script setup>
import { store, actions } from '../store.js';

const langOptions = [
  { value: 'python3', label: 'Python 3' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'typescript', label: 'TypeScript' },
];
</script>

<template>
  <h3>运行参数</h3>
  <div class="field checks">
    <label><input type="checkbox" v-model="store.forms.cooldownEnabled" />冷却启用</label>
    <label><input type="checkbox" v-model="store.forms.dryRun" />Dry-Run（模拟判题）</label>
  </div>
  <div class="field"><label>每日提交配额</label><input v-model.number="store.forms.quota" type="number" min="1" max="50" /></div>
  <div class="field">
    <label>AC 后翻译提交的语言（每个语言都是真实提交，计入配额）</label>
    <span class="checks">
      <label v-for="l in langOptions" :key="l.value">
        <input type="checkbox" :value="l.value" v-model="store.forms.translateLangs" />{{ l.label }}
      </label>
    </span>
  </div>
  <button @click="actions.saveLimits">保存参数</button>
  <button class="ghost" @click="actions.syncProblems">↻ 重新同步题库</button>
</template>
