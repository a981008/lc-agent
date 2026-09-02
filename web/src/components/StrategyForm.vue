<script setup>
import { store, actions } from '../store.js';

const difficultyOptions = [
  { value: 'Easy', label: '易' },
  { value: 'Medium', label: '中' },
  { value: 'Hard', label: '难' },
];
</script>

<template>
  <h3>策略（下一题生效）</h3>
  <div class="field">
    <label>刷题模式</label>
    <select v-model="store.forms.mode">
      <option value="sequential">顺序</option>
      <option value="random">随机</option>
      <option value="tag">标签/难度</option>
    </select>
  </div>
  <div class="field">
    <label>难度</label>
    <span class="checks">
      <label v-for="d in difficultyOptions" :key="d.value">
        <input type="checkbox" :value="d.value" v-model="store.forms.difficulty" />{{ d.label }}
      </label>
    </span>
  </div>
  <div class="field">
    <label>标签 slug</label>
    <input v-model="store.forms.tag" placeholder="如 dynamic-programming" />
  </div>
  <button @click="actions.saveStrategy">保存策略</button>
</template>
