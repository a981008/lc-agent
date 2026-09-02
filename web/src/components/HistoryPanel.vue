<script setup>
import { store, actions } from '../store.js';
import ProblemsTable from './ProblemsTable.vue';
import SolutionsTable from './SolutionsTable.vue';
</script>

<template>
  <section class="panel wide panel-history">
    <div class="tabs">
      <button class="tab" :class="{ active: store.tab === 'problems' }" @click="actions.switchTab('problems')">题目列表</button>
      <button class="tab" :class="{ active: store.tab === 'solutions' }" @click="actions.switchTab('solutions')">AC 题解</button>
    </div>

    <div v-show="store.tab === 'problems'" class="table-wrap"><ProblemsTable /></div>
    <div v-show="store.tab === 'solutions'" class="table-wrap"><SolutionsTable /></div>
  </section>
</template>
