<script setup>
import { nextTick, ref, watch } from 'vue';
import { store } from '../store.js';
import LogTerminal from './LogTerminal.vue';

const aiBody = ref(null);
watch(() => store.aiProcess, async () => {
  await nextTick();
  if (aiBody.value) aiBody.value.scrollTop = aiBody.value.scrollHeight;
});
</script>

<template>
  <section class="panel panel-pipeline">
    <h3>Pipeline</h3>
    <div class="pipeline">
      <span :class="store.stages.fetch">抓取</span> →
      <span :class="store.stages.generate">AI 生成</span> →
      <span :class="store.stages.local_test">本地沙盒</span> →
      <span :class="store.stages.submit">提交</span> →
      <span :class="store.stages.translate">多语言</span> →
      <span :class="store.stages.archive">归档</span>
    </div>
    <div class="hint">{{ store.currentProblem }}</div>
    <div v-if="store.aiProcess" class="ai-process">
      <div class="ai-process-head">🤖 AI 解题过程（{{ store.aiProcessStage === 'translate' ? '多语言翻译' : '思考与编码' }}）</div>
      <div class="ai-process-body" ref="aiBody">{{ store.aiProcess }}</div>
    </div>
    <h3>实时日志</h3>
    <LogTerminal />
  </section>
</template>
