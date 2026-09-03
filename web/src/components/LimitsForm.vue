<script setup>
import { store, actions } from '../store.js';

// 与 leetcode.cn 题目 codeSnippets 的 langSlug 一致（Go 是 golang；cangjie=仓颉）
const langOptions = [
  { value: 'python3', label: 'Python 3' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'csharp', label: 'C#' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'golang', label: 'Go' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
  { value: 'rust', label: 'Rust' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'dart', label: 'Dart' },
  { value: 'scala', label: 'Scala' },
  { value: 'elixir', label: 'Elixir' },
  { value: 'erlang', label: 'Erlang' },
  { value: 'racket', label: 'Racket' },
  { value: 'cangjie', label: '仓颉' },
];
const isAll = () => store.forms.translateLangs.includes('all');
function toggleAll() {
  store.forms.translateLangs = isAll() ? [] : ['all'];
}
</script>

<template>
  
  <div class="field checks">
    <label><input type="checkbox" v-model="store.forms.cooldownEnabled" />冷却启用</label>
    <label><input type="checkbox" v-model="store.forms.dryRun" />Dry-Run（模拟判题）</label>
  </div>
  <div class="field"><label>每日提交配额</label><input v-model.number="store.forms.quota" type="number" min="1" max="1000" /></div>
  <div class="field checks">
    <label><input v-model.number="store.forms.cooldownMin" type="number" min="1" max="7200" style="width:80px" />最小冷却（秒）</label>
    <label><input v-model.number="store.forms.cooldownMax" type="number" min="1" max="7200" style="width:80px" />最大冷却（秒）</label>
    <span class="muted">实际值在区间内随机采样；修改对进行中的冷却即时生效</span>
  </div>
  <div class="field">
    <label>AC 后翻译提交的语言（每个语言都是真实提交，计入配额；仅该题实际提供的语言生效）</label>
    <span class="checks">
      <label><input type="checkbox" :checked="isAll()" @change="toggleAll" /><b>全部（该题支持的所有语言）</b></label>
      <label v-for="l in langOptions" :key="l.value">
        <input type="checkbox" :value="l.value" v-model="store.forms.translateLangs" :disabled="isAll()" />{{ l.label }}
      </label>
    </span>
  </div>
  <button @click="actions.saveLimits">保存参数</button>
  <button class="ghost" @click="actions.syncProblems">↻ 重新同步题库</button>
</template>
