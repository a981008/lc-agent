import { createApp } from 'vue';
import App from './App.vue';
import { initToken } from './store.js';
import './style.css';
import 'katex/dist/katex.min.css';
import { applyTheme } from './theme.js';

applyTheme(); // 主题在 index.html 内联脚本已定，这里补挂 matchMedia 监听
createApp(App).mount('#app');
// 启动即尝试登录（localStorage 或 ?token= 已就绪）：成功则直接进入面板，否则停留在 TokenGate
void initToken();
