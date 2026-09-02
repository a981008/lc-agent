<script setup>
import { store, actions, lcProblemUrl } from '../store.js';

function fmtTime(ts) {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <table>
    <thead>
      <tr><th>题号</th><th>题目</th><th>难度</th><th>AC 时间</th><th>操作</th></tr>
    </thead>
    <tbody>
      <tr v-for="s in store.solutions" :key="s.problem_id">
        <td>{{ s.slug }}</td>
        <td><a class="lc-link" :href="lcProblemUrl(s.slug)" target="_blank" rel="noopener" :title="'在 LeetCode 打开 ' + s.slug">{{ s.title || s.slug }} ↗</a></td>
        <td :class="'diff-' + (s.difficulty ?? '')">{{ s.difficulty ?? '' }}</td>
        <td>{{ fmtTime(s.created_at) }}</td>
        <td class="actions"><button @click="actions.viewSolution(s.problem_id)">查看题解</button></td>
      </tr>
    </tbody>
  </table>
</template>
