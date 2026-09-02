<script setup>
import { store, actions } from '../store.js';
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
        <td>{{ p.title_cn || p.title || '' }}</td>
        <td :class="'diff-' + (p.difficulty ?? '')">{{ p.difficulty ?? '' }}</td>
        <td>{{ p.paid_only ? '🔒' : '' }} {{ p.ac_status ? '✅ AC' : p.lifecycle }}</td>
        <td>{{ p.attempts_count }}</td>
        <td class="actions"><button @click="actions.viewAttempts(p.slug)">尝试记录</button></td>
      </tr>
    </tbody>
  </table>
  <div class="pager">
    <button @click="actions.pagePrev">‹ 上一页</button>
    <span>第 {{ store.page }} 页 / 共 {{ store.problems.total }} 题</span>
    <button @click="actions.pageNext">下一页 ›</button>
  </div>
</template>
