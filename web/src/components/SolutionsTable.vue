<script setup>
import { store, actions, lcProblemUrl } from '../store.js';

const TAG_OPTIONS = [
  ['array', '数组'], ['string', '字符串'], ['hash-table', '哈希表'], ['linked-list', '链表'],
  ['two-pointers', '双指针'], ['sliding-window', '滑动窗口'], ['binary-search', '二分查找'],
  ['sorting', '排序'], ['stack', '栈'], ['queue', '队列'], ['heap-priority-queue', '堆'],
  ['tree', '树'], ['binary-tree', '二叉树'], ['graph', '图'], ['depth-first-search', 'DFS'],
  ['breadth-first-search', 'BFS'], ['backtracking', '回溯'], ['dynamic-programming', '动态规划'],
  ['greedy', '贪心'], ['math', '数学'], ['bit-manipulation', '位运算'], ['prefix-sum', '前缀和'],
  ['recursion', '递归'], ['matrix', '矩阵'], ['design', '设计'], ['database', '数据库'],
];

function fmtTime(ts) {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="filter-bar">
    <input class="f-q" v-model="store.sFilters.q" placeholder="搜题号 / 标题，回车检索" @keyup.enter="actions.applySFilters" />
    <span class="f-checks">
      <label v-for="d in [['Easy','易'],['Medium','中'],['Hard','难']]" :key="d[0]">
        <input type="checkbox" :value="d[0]" v-model="store.sFilters.difficulty" @change="actions.applySFilters" />{{ d[1] }}
      </label>
    </span>
    <select v-model="store.sFilters.tag" @change="actions.applySFilters">
      <option value="">分类：全部</option>
      <option v-for="t in TAG_OPTIONS" :key="t[0]" :value="t[0]">{{ t[1] }}</option>
    </select>
    <button class="f-btn" @click="store.sFilters = { q: '', difficulty: [], tag: '' }; actions.applySFilters()">重置</button>
  </div>
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
