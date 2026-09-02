/* 启动预检：better-sqlite3 原生模块与当前 Node ABI 是否匹配（.cjs 以绕过 ESM package） */
'use strict';

try {
  require('better-sqlite3');
} catch (e) {
  const msg = (e && e.message) || '';
  if (e && (e.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(msg))) {
    console.error(`[lc-agent] better-sqlite3 与当前 Node ${process.version} 不匹配（NODE_MODULE_VERSION 冲突）。`);
    console.error('  推荐使用 Node 22：nvm use 22（项目已带 .nvmrc）；新终端默认 22 可执行 nvm alias default 22');
    console.error('  如必须用当前 Node 版本：npm rebuild better-sqlite3 --cache ./.npm-cache');
    process.exit(1);
  }
  throw e;
}
