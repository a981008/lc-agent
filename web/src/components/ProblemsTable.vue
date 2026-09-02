<script setup>
import { computed } from 'vue';
import { store, actions, lcProblemUrl } from '../store.js';

const totalPages = computed(() => Math.max(1, Math.ceil((store.problems.total ?? 0) / store.pageSize)));
</script>

<template>
  <table>
    <thead>
      <tr><th>#</th><th>题号</th><th>题目</th><th>难度</th><th>状态</th><th>尝试</th><th>操作</th></tr>
    </thead>
    <tbody>
      <tr v-for="p in store.problems.items" :key="p.slug">
        <td></td>
        <td>{{ p.slug }}</td>
        <td><a class="lc-link" :href="lcProblemUrl(p.slug)" target="_blank" rel="noopener" :title="'在 LeetCode 打开 ' + p.slug">{{ p.title_cn || p.title || p.slug }} ↗</a></td>
        <td :class="'diff-' + (p.difficulty ?? '')">{{ p.difficulty ?? '' }}</td>
        <td>{{ p.paid_only ? '🔒' : '' }} {{ p.ac_status ? '✅ AC' : p.lifecycle }}</td>
        <td>{{ p.attempts_count }}</td>
        <td class="actions"><button @click="actions.viewAttempts(p.slug)">尝试记录</button></td>
      </tr>
    </tbody>
  </table>
  <div class="pager">
    <button :disabled="store.page <= 1" @click="actions.pagePrev">‹ 上一页</button>
    <span>第 <b>{{ store.page }}</b> / {{ totalPages }} 页（共 {{ store.problems.total }} 题）</span>
    <button :disabled="store.page >= totalPages" @click="actions.pageNext">下一页 ›</button>
    <span class="spacer"></span>
    <label class="pager-size">每页
      <select :value="store.pageSize" @change="actions.setPageSize($event.target.value)">
        <option value="20">20</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
      条
    </label>
  </div>
</template>
