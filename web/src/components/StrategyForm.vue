<script setup>
import { store, actions } from '../store.js';

const difficultyOptions = [
  { value: 'Easy', label: '易' },
  { value: 'Medium', label: '中' },
  { value: 'Hard', label: '难' },
];

// LC 官方知识点（题解 topicTags 的高频子集，value 为站点 slug，与 problem_records.tags 匹配）
const tagOptions = [
  { value: 'array', label: '数组' },
  { value: 'string', label: '字符串' },
  { value: 'hash-table', label: '哈希表' },
  { value: 'linked-list', label: '链表' },
  { value: 'two-pointers', label: '双指针' },
  { value: 'sliding-window', label: '滑动窗口' },
  { value: 'binary-search', label: '二分查找' },
  { value: 'sorting', label: '排序' },
  { value: 'stack', label: '栈' },
  { value: 'queue', label: '队列' },
  { value: 'heap-priority-queue', label: '堆（优先队列）' },
  { value: 'tree', label: '树' },
  { value: 'binary-tree', label: '二叉树' },
  { value: 'graph', label: '图' },
  { value: 'depth-first-search', label: '深度优先搜索' },
  { value: 'breadth-first-search', label: '广度优先搜索' },
  { value: 'backtracking', label: '回溯' },
  { value: 'dynamic-programming', label: '动态规划' },
  { value: 'greedy', label: '贪心' },
  { value: 'math', label: '数学' },
  { value: 'bit-manipulation', label: '位运算' },
  { value: 'prefix-sum', label: '前缀和' },
  { value: 'recursion', label: '递归' },
  { value: 'matrix', label: '矩阵' },
  { value: 'design', label: '设计' },
  { value: 'database', label: '数据库' },
];
</script>

<template>
  
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
  <div class="field" v-show="store.forms.mode === 'tag'">
    <label>知识点（LC 官方标签）</label>
    <select v-model="store.forms.tag">
      <option value="">不限</option>
      <option v-for="t in tagOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
    </select>
  </div>
  <button @click="actions.saveStrategy">保存策略</button>
</template>
