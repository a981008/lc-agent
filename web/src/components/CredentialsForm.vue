<script setup>
import { store, actions } from '../store.js';
</script>

<template>
  <h3>LeetCode 凭据（leetcode.cn）</h3>
  <p class="hint">浏览器 F12 → Application → Cookies → leetcode.cn，复制 LEETCODE_SESSION 与 csrftoken。建议使用小号。</p>
  <div class="field"><label>LEETCODE_SESSION</label><textarea v-model="store.forms.session" rows="3"></textarea></div>
  <div class="field"><label>csrftoken</label><input v-model="store.forms.csrftoken" /></div>
  <div class="field">
    <label>或粘贴整个 Cookie 请求头（自动解析上面两项）</label>
    <textarea v-model="store.forms.cookieHeader" rows="2" placeholder="LEETCODE_SESSION=eyJ...; csrftoken=...; Hm_lvt_...="></textarea>
  </div>
  <button @click="actions.saveCookie">保存并探针</button>
  <span class="hint">{{ store.cookieResult }}</span>
</template>
