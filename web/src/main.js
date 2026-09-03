import { createApp } from 'vue';
import App from './App.vue';
import { initToken } from './store.js';
import './style.css';
import 'katex/dist/katex.min.css';

createApp(App).mount('#app');
// 启动即尝试登录（localStorage 或 ?token= 已就绪）：成功则直接进入面板，否则停留在 TokenGate
void initToken();
