# lc-agent — 全自动 LeetCode 机器人系统

全 JS/TS 技术栈的刷题与监控平台：**前端可视化控制台 + 后端异步任务引擎 + Docker 沙盒 + AI 大模型**。

规格文档：[`spec.md`](spec.md)（总索引）+ [`docs/`](docs/)（模块详情）。当前实现覆盖 **M1 骨架 + M2 自愈闭环 + M3 调度风控** 的核心链路。

## 仓库地址

- **Gitee（国内推荐）**：<https://gitee.com/a981008/lc-agent>
- **GitHub**：<https://github.com/a981008/lc-agent>

```bash
git clone git@gitee.com:a981008/lc-agent.git   # 国内服务器走 gitee 快
# 或：git clone git@github.com:a981008/lc-agent.git
```

## 快速开始

```bash
npm install
./lc.sh start          # 后台启动（推荐）：自动安装/构建前端并就绪探测；--dry-run 模拟判题，--fg 前台运行
# 等价：npm run start:daemon / stop:daemon / status:daemon / logs:daemon
```

`lc.sh` 命令：`start [--dry-run] [--fg]` · `stop`（SIGTERM 优雅停机，超时强杀）· `restart` · `status`（含 Token）· `logs`（跟踪日志）。PID 与日志在 `logs/` 下。

> **Node 版本**：本项目要求 Node ≥ 22（`.nvmrc` 已配置）。若启动报 `NODE_MODULE_VERSION` 冲突，见下方[故障排查](#故障排查)。

## 前端（标准 Vue 工程）

`web/` 是独立的 Vue 3 + Vite 项目（SFC 组件化）：

```bash
npm run web:build      # 构建产物 → web/dist/（后端静态服务；lc.sh start 会自动构建）
npm run web:dev        # 开发模式：Vite :5173，/api 与 /ws 代理到后端 3081
```

结构：`src/App.vue` + `components/`（13 个 SFC）+ `store.js`（reactive 状态/动作）+ `api.js` + `markdown.js`。

启动后按控制台打印的 **Dashboard Token** 登录面板（也写入 `data/dashboard-token.txt`）：

1. **配置 LeetCode 凭据**（leetcode.cn）：浏览器 F12 → Application → Cookies，复制 `LEETCODE_SESSION` 与 `csrftoken` 填入面板「LeetCode 凭据」→ 保存并探针（✅ 即登录成功）。**建议小号**，见 `docs/01` 风险声明。
2. **配置 LLM**（OpenAI 兼容）：填 Base URL（如 `https://api.deepseek.com/v1`）、Model、API Key。
3. **⚡ 跑这题**：题目列表里任选一题立即触发（仅空闲/暂停时）；付费题需会员，非会员自动跳过。
4. 右侧实时观察：抓取 → AI 生成（**流式展示 AI 写码过程**）→ 本地沙盒 → 提交 → 判题 → 多语言翻译 → 归档；底部页签查看题目列表与题解。

每次真实提交后进入 3–12 分钟随机冷却（锚定上次提交时间，可在「运行参数」临时关闭）；触发 CAPTCHA 自动熔断进 `BLOCKED`，需人工更新凭据确认。

**一题多解**：主解法 AC 后由 AI 自主规划该题还值得几种「思路本质不同」的解法（简单题可为 0），逐个本地沙盒验证 + 真实提交，仅保留 AC 的进题解「多解法」小节——每个解法附思路讲解、关键实现细节与复杂度分析。

**多语言翻译**：JS AC 后自动把解法翻译为 Python 3 / C++ / Java（可在「运行参数」勾选）并逐个真实提交，同样要求 AC；题解的 AC 代码区以页签呈现各语言实现。翻译若在该语言下 TLE（解法本身正确），会以「XX（TLE）」页签保留标注。注意每个语言的提交都计入每日配额。

**每日一题自动完成**：开启后（运行参数，默认开）引擎每 20 分钟检查官方每日一题并自动跑完整流水线，当天只跑一次；已 AC、付费题自动跳过。

**面板特性**：题目/题解检索（关键词、状态、难度、知识点分类、会员题筛选）、题解弹窗多语言代码页签（一键复制当前页签）、日志分页（长跑不涨内存）、明暗双主题（可跟随系统）、手机端适配。

## 自测与运行模式

```bash
npm run selftest   # 无凭据自测：driver 黄金用例 + Docker 沙盒 + LC 匿名接口
npm run typecheck
DRY_RUN=1 npm start   # 模拟判题模式：无 Cookie/LLM 也能全链路演练（内置 two-sum 占位解法）
```

## 架构速览

```
web/          前端：标准 Vue 3 + Vite 工程（SFC 组件化，构建产物 dist/ 由后端服务）
src/
  index.ts    引导：装配/探针/优雅停机        server/   REST + WS（事件契约 docs/10）
  state/      六态状态机 + 锚定冷却 + 熔断     engine/   单题管线 + WA 回填自愈 + 归档
  sandbox/    Docker 一次性容器 + driver 生成  leetcode/ 限速串行客户端（5s 间隔）
  ai/         OpenAI 兼容客户端 + prompt      db/       SQLite（单一写入者）
  budget.ts   LLM 预算（每日上限/告警）        events.ts 事件中心（seq 环形缓冲/断线补发）
```

详细设计（状态迁移表、失败分流、事件契约、Schema）见 `docs/03` `docs/06` `docs/10`。

## 故障排查

**启动报 `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION 127 … requires 115`**
`better-sqlite3` 原生模块与其余 Node 版本的 ABI 不匹配（本机装了多个 Node，默认版本与项目不一致）：

```bash
nvm use 22                    # 本项目使用 Node 22（.nvmrc 已配置，进目录后 nvm use 自动生效）
nvm alias default 22          # 可选：让新终端默认用 22
npm run start
```

如必须用其他 Node 版本：`npm rebuild better-sqlite3 --cache ./.npm-cache`（按当前版本重编原生模块；注意多版本混用时每次切换都需重编）。

## 配置

环境变量见 [.env.example](.env.example)；运行参数（冷却、配额、预算、时间窗）存库，面板可改。敏感值（Cookie / API Key）AES-256-GCM 加密落库，日志强制脱敏。

**服务器部署**：完整清单见 [`docs/12-deployment.md`](docs/12-deployment.md)（`.env` 必改项、systemd、nginx+WS、备份迁移、上线检查清单）。

