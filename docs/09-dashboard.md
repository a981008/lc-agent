---
title: 前端监控面板 (Dashboard UI)
related: [10-data-protocols.md, 03-state-machine.md]
source: v0.2 §4
---

# 1. 布局总览

前端为 **标准 Vue 3 工程（Vite + SFC 组件化）**，位于 `web/`：`npm run build` 产出 `web/dist/`，由后端 express 静态服务；开发模式 `npm run dev`（Vite 5173 端口，`/api` 与 `/ws` 代理到 3081）。结构：`src/App.vue`（根）+ `components/`（TokenGate / TopBar / ControlPanel / StrategyForm / CredentialsForm / LlmForm / LimitsForm / PipelineView / LogTerminal / HistoryPanel / ProblemsTable / SolutionsTable / AppModal）+ `store.js`（reactive 全局状态与动作，无 pinia 的轻量层）+ `api.js`（REST/Token 管理，401 全局登出）+ `markdown.js`。划分为以下 4 个功能区：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        【 Top Bar: 系统与账号状态 】                     │
│ 账号: UserA (Cookie: 有效) | 整体 AC: 320/2854* | 积分: 1850 | 状态: 🟢 RUNNING │
├──────────────────────────────────┬─────────────────────────────────────┤
│      【 左侧：控制与策略配置 】     │       【 右侧：实时 Pipeline 控制台 】   │
│ 刷题模式: [ 随机 ▾ ]             │ [#206 反转链表]                      │
│ 标签筛选: [ 动态规划 ▾ ]          │ [抓取] -> [AI生成] -> [本地沙盒] -> [提交AC]│
│ 难度限制: [☑易  ☑中  ☐难]         │                                     │
│ 按钮: [▶ 恢复] [⏸ 暂停] [⚡ 跑单题]│ [ 实时 Log 窗口 (WebSocket 终端流) ]  │
├──────────────────────────────────┴─────────────────────────────────────┤
│                        【 底部：历史 AC 题解与列表 】                    │
│ 题号 | 题目名称 | 难度 | AC 时间 | 性能击败 | 状态 | 操作 (预览 Markdown)     │
└────────────────────────────────────────────────────────────────────────┘
                          (* 分母动态取自题目库同步总数, 非写死)
```

# 2. 功能区规格

1. **Top Bar (账号与系统状态区)**：
   * 显示当前 LeetCode Cookie 存活状态、总刷题统计饼图、系统当前状态机状态（`RUNNING` / `PAUSED` / `COOLING` / `IN_PROGRESS` / `BLOCKED`）。
   * **分母动态化**：总题数取自题目库实时同步结果，不写死。

2. **Strategy Controller (策略控制区)**：
   * 提供模式切换下拉框、标签过滤器、暂停/恢复开关，修改后实时通过 REST API 同步至后端服务（生效语义见 [03-state-machine.md](03-state-machine.md)：下一题生效）。

3. **Live Pipeline & Terminal (实时流水线与日志)**：
   * 可视化展示当前题目在闭环中的位置（抓取 → 本地沙盒 → 提交 → 归档）。
   * 集成 WebSocket 终端日志流，实时滚动打印后端 Worker 的详细输出。
   * **断线回放**：WS 断开重连后按 `seq` 由服务端环形缓冲补发；超出缓冲范围时回退到 `GET /api/logs?since_seq=` 全量回放（契约见 [10-data-protocols.md](10-data-protocols.md)）。

4. **Solution Viewer (题解与历史区)**：
   * 表格呈现已 AC 的题目列表，支持点击直接弹窗渲染 Markdown 格式的解题报告；同时展示 `skipped` 题目与原因。

# 3. 面板自身的安全基线

* Dashboard 默认**开启鉴权**（Token 认证），服务默认仅绑定 `127.0.0.1`；公网部署必须经反代 + HTTPS。
* 面板可显示"Cookie 有效/失效"的布尔状态，但**任何接口不得返回 Cookie 原文或 CSRF Token**（脱敏契约见 [10-data-protocols.md](10-data-protocols.md)）。

---

> 导航：[索引](../spec.md) · 上一节：[08-ai-budget.md](08-ai-budget.md) · 下一节：[10-data-protocols.md](10-data-protocols.md)
