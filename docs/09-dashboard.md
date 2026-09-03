---
title: 前端监控面板 (Dashboard UI)
related: [10-data-protocols.md, 03-state-machine.md]
source: v0.2 §4
---

# 1. 布局总览

前端为 **标准 Vue 3 工程（Vite + SFC 组件化）**，位于 `web/`：`npm run build` 产出 `web/dist/`，由后端 express 静态服务；开发模式 `npm run dev`（Vite 5173 端口，`/api` 与 `/ws` 代理到 3081）。结构：`src/App.vue`（根）+ `components/`（TokenGate / TopBar / ControlPanel / StrategyForm / CredentialsForm / LlmForm / LimitsForm / PipelineView / LogTerminal / HistoryPanel / ProblemsTable / SolutionsTable / AppModal）+ `store.js`（reactive 全局状态与动作，无 pinia 的轻量层）+ `api.js`（REST/Token 管理，401 全局登出）+ `markdown.js`。划分为以下 4 个功能区：

```
┌────────────────────────────────────────────────────────────────────────┐
│                  【 Top Bar: 系统与账号状态 + 版本/主题 】                │
│ 账号: UserA (Cookie: 有效) | 整体 AC: 320/3903* | v0.53 | 🌓 主题三态切换 | 状态: 🟢 RUNNING │
├──────────────────────────────────┬─────────────────────────────────────┤
│      【 左侧：控制与策略配置 】     │       【 右侧：实时 Pipeline 控制台 】   │
│ 刷题模式: [ 随机 ▾ ]             │ [#70 爬楼梯]                        │
│ 标签筛选: [ 动态规划 ▾ ]          │ [抓取]->[AI生成]->[本地沙盒]->[提交AC]->[翻译]->[归档] │
│ 难度限制: [☑易  ☑中  ☐难]         │ 🤖 AI 解题过程（生成阶段实时流式输出）    │
│ 按钮: [▶ 恢复] [⏸ 暂停] [⚡ 跑这题] │ [ 实时 Log 窗口（分页：加载更早/回到最新）] │
│ 运行参数: 配额/冷却/Dry-Run/每日一题开关 │                              │
├──────────────────────────────────┴─────────────────────────────────────┤
│              【 底部页签：题目列表 | AC 题解 】                           │
│ 题目: 检索栏(关键词/状态/难度/分类/会员题) + 题号|题目|难度|状态|操作        │
│ 题解: 检索栏(关键词/难度/分类) + 题号|题目|难度|AC 时间|操作 (弹窗渲染 Markdown)│
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
   * 底部两个页签：**题目列表**（全量题库，检索栏支持关键词/状态三态/难度多选/知识点分类/会员题筛选；会员题带金色「会员」徽章；非会员的付费题「跑这题」按钮禁用）与 **AC 题解**（已归档题解，支持关键词/难度/分类检索）。
   * 点击题解弹窗渲染 Markdown：多语言 AC 代码页签（含「XX（TLE）」标注页签）、**「多解法」小节**（AI 规划的多种思路，每个解法配讲解 + 已 AC 代码）、复制按钮只复制当前激活页签。

5. **AI 解题过程 (PipelineView 内)**：
   * 仅**生成阶段**的 LLM 流式输出实时展示（SSE 增量经 WS `pipeline_step(delta)` 推送，400ms/800 字符合帧）；翻译等其余阶段只更新阶段状态灯。

6. **日志终端分页 (LogTerminal)**：
   * 按「尾部窗口」分页渲染（默认最新 150 条）：「↑ 加载更早」逐页扩窗、「↓ 回到最新」收回；prepend 视口不跳动，跟随模式自动滚底。DOM 常驻节点恒 ≤ 窗口大小，长跑不无限变大。

7. **每日一题自动完成 (LimitsForm 开关)**：
   * 开启后引擎每 20min 轮询官方 `todayRecord`（启动 90s 首查），自动触发当日每日一题全流水线；已 AC 标记完成、付费题跳过、配额不足延后。手动补跑：`POST /api/admin/daily-challenge`（`{"force":true}` 绕过忙状态）。

8. **主题与移动端**：
   * 明/暗/跟随系统三态主题（`web/src/theme.js`，localStorage 持久化 + `color-scheme` 原生适配）；≤960px 单列布局、弹窗贴底全宽、输入 16px 防 iOS 缩放（详见 changelog v0.44）。

# 3. 面板自身的安全基线

* Dashboard 默认**开启鉴权**（Token 认证），服务默认仅绑定 `127.0.0.1`；公网部署必须经反代 + HTTPS。
* 面板可显示"Cookie 有效/失效"的布尔状态，但**任何接口不得返回 Cookie 原文或 CSRF Token**（脱敏契约见 [10-data-protocols.md](10-data-protocols.md)）。

---

> 导航：[索引](../spec.md) · 上一节：[08-ai-budget.md](08-ai-budget.md) · 下一节：[10-data-protocols.md](10-data-protocols.md)
