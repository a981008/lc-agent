<script setup>
import { store, actions } from '../store.js';
</script>

<template>
  <h3>LLM</h3>
  <div class="field">
    <label>协议</label>
    <select v-model="store.forms.llmProtocol">
      <option value="openai">OpenAI 兼容（/v1/chat/completions）</option>
      <option value="anthropic">Anthropic Messages（/v1/messages）</option>
    </select>
  </div>
  <div class="field"><label>Base URL</label><input v-model="store.forms.llmBase" placeholder="https://api.example.com/v1" /></div>
  <div class="field"><label>Model</label><input v-model="store.forms.llmModel" placeholder="模型名" /></div>
  <div class="field"><label>API Key</label><input v-model="store.forms.llmKey" type="password" placeholder="留空保持不变" /></div>
  <button @click="actions.saveLlm">保存 LLM 配置</button>
</template>
