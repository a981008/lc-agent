<script setup>
import { onMounted } from 'vue';
import { store, actions } from '../store.js';

onMounted(() => { if (!store.languages.length) actions.loadLanguages(); });


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
  <div class="field">
    <label>每日提交配额（0 = 无限制）</label>
    <span class="checks">
      <input v-model.number="store.forms.quota" type="number" min="0" max="1000" :disabled="store.forms.quotaUnlimited" style="width:90px" />
      <label><input type="checkbox" v-model="store.forms.quotaUnlimited" />无限制</label>
    </span>
  </div>
  <div class="field checks">
    <label><input v-model.number="store.forms.cooldownMin" type="number" min="1" max="7200" style="width:80px" />最小冷却（秒）</label>
    <label><input v-model.number="store.forms.cooldownMax" type="number" min="1" max="7200" style="width:80px" />最大冷却（秒）</label>
    <span class="muted">实际值在区间内随机采样；修改对进行中的冷却即时生效</span>
  </div>
  <div class="field">
    <label>AC 后翻译提交的语言（每个语言都是真实提交，计入配额；仅该题实际提供的语言生效）</label>
    <span class="checks">
      <label class="lang-chip lang-all"><input type="checkbox" :checked="isAll()" @change="toggleAll" /><b>全部</b></label>
      <label v-for="l in store.languages" :key="l" class="lang-chip">
        <input type="checkbox" :value="l" v-model="store.forms.translateLangs" :disabled="isAll()" />{{ l }}
      </label>
      <span v-if="!store.languages.length" class="muted">语言列表加载中…</span>
    </span>
  </div>
  <button @click="actions.saveLimits">保存参数</button>
  <button class="ghost" @click="actions.syncProblems">↻ 重新同步题库</button>
</template>
