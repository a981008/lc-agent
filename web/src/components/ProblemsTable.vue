<script setup>
import { computed } from 'vue';
import { store, actions, lcProblemUrl } from '../store.js';

// 与策略表单一致的 LC 知识点选项（value 为站点 slug）
const TAG_OPTIONS = [
  ['array', '数组'], ['string', '字符串'], ['hash-table', '哈希表'], ['linked-list', '链表'],
  ['two-pointers', '双指针'], ['sliding-window', '滑动窗口'], ['binary-search', '二分查找'],
  ['sorting', '排序'], ['stack', '栈'], ['queue', '队列'], ['heap-priority-queue', '堆'],
  ['tree', '树'], ['binary-tree', '二叉树'], ['graph', '图'], ['depth-first-search', 'DFS'],
  ['breadth-first-search', 'BFS'], ['backtracking', '回溯'], ['dynamic-programming', '动态规划'],
  ['greedy', '贪心'], ['math', '数学'], ['bit-manipulation', '位运算'], ['prefix-sum', '前缀和'],
  ['recursion', '递归'], ['matrix', '矩阵'], ['design', '设计'], ['database', '数据库'],
];

const totalPages = computed(() => Math.max(1, Math.ceil((store.problems.total ?? 0) / store.pageSize)));

// 三态刷题状态：已解答（AC）→ 尝试过（有尝试未 AC）→ 待完成
function statusOf(p) {
  if (p.ac_status) return { key: 'solved', label: '已解答' };
  if (p.attempts_count > 0) return { key: 'attempted', label: '尝试过' };
  return { key: 'todo', label: '待完成' };
}
// 仅 IDLE/PAUSED 可手动触发（后端 trigger-once 同规则）
const canRun = computed(() => ['IDLE', 'PAUSED'].includes(store.status?.state ?? ''));
const currentSlug = computed(() => store.status?.currentSlug ?? null);
</script>

<template>
  <div class="filter-bar">
    <input class="f-q" v-model="store.pFilters.q" placeholder="搜题号 / 标题 / slug，回车检索" @keyup.enter="actions.applyPFilters" />
    <select v-model="store.pFilters.status" @change="actions.applyPFilters">
      <option value="">状态：全部</option>
      <option value="todo">待完成</option>
      <option value="attempted">尝试过</option>
      <option value="solved">已解答</option>
    </select>
    <span class="f-checks">
      <label v-for="d in [['Easy','易'],['Medium','中'],['Hard','难']]" :key="d[0]">
        <input type="checkbox" :value="d[0]" v-model="store.pFilters.difficulty" @change="actions.applyPFilters" />{{ d[1] }}
      </label>
    </span>
    <select v-model="store.pFilters.tag" @change="actions.applyPFilters">
      <option value="">分类：全部</option>
      <option v-for="t in TAG_OPTIONS" :key="t[0]" :value="t[0]">{{ t[1] }}</option>
    </select>
    <button class="f-btn" @click="store.pFilters = { q: '', status: '', difficulty: [], tag: '' }; actions.applyPFilters()">重置</button>
  </div>
  <table>
    <thead>
      <tr><th>题号</th><th>题目</th><th>难度</th><th>状态</th><th>操作</th></tr>
    </thead>
    <tbody>
      <tr v-for="p in store.problems.items" :key="p.slug" :class="{ 'row-running': currentSlug === p.slug }">
        <td>{{ p.slug }}</td>
        <td><a class="lc-link" :href="lcProblemUrl(p.slug)" target="_blank" rel="noopener" :title="'在 LeetCode 打开 ' + p.slug">{{ p.title_cn || p.title || p.slug }} ↗</a></td>
        <td :class="'diff-' + (p.difficulty ?? '')">{{ p.difficulty ?? '' }}</td>
        <td><span :class="['pstatus', 'pstatus-' + statusOf(p).key]">{{ p.paid_only ? '🔒' : '' }} {{ statusOf(p).label }}</span></td>
        <td class="actions">
          <button
            class="run-btn"
            :disabled="!canRun || !!p.paid_only"
            :title="p.paid_only ? '付费题不支持' : (!canRun ? '仅空闲/暂停时可触发' : '立即跑这一题（Trigger Once）')"
            @click="actions.runProblem(p.slug)"
          >{{ currentSlug === p.slug ? '⏳ 运行中' : '▶ 跑这题' }}</button>
          <button @click="actions.viewAttempts(p.slug)">尝试记录</button>
        </td>
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
