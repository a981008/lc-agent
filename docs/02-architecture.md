---
title: 总体架构、数据流与崩溃恢复
related: [03-state-machine.md, 04-auth-risk.md, 10-data-protocols.md, 01-goals-scope-risk.md]
source: v0.2 §2（含 §2.1、§2.2）
---

# 1. 三层架构与数据流

系统分为三个核心层级：**前端控制层 (Dashboard)**、**后端服务与控制层 (Control Server)**、**刷题执行引擎 (Worker Engine)**。

```
 ┌─────────────────────────────────────────────────────────────┐
 │                1. 前端控制面板 (Dashboard)                   │
 │   - 账号状态 / 统计指标   - 模式选择器   - 暂停/恢复/触发控制   │
 │   - 实时 Pipeline 进度   - 终端日志流   - 题解列表与查看器      │
 └──────────────┬──────────────────────────────▲───────────────┘
                │ REST API (指令控制, 需鉴权)    │ WebSocket (状态/日志广播)
                ▼                              │
 ┌─────────────────────────────────────────────┴───────────────┐
 │               2. 后端服务与控制层 (Control Server)            │
 │   - State Machine: IDLE/RUNNING/COOLING/IN_PROGRESS/        │
 │                     PAUSED/BLOCKED (单例, 持久化)            │
 │   - Auth Manager: Cookie 状态校验与更新                      │
 │   - Strategy Scheduler: 任务选题策略与冷却调度               │
 │   - Repository: 唯一持久化写入点 (单一写入者)                │
 └──────────────┬──────────────────────────────▲───────────────┘
                │ 调度/挂起指令                 │ 执行事件/报错回调
                ▼                              │
 ┌─────────────────────────────────────────────┴───────────────┐
 │               3. 刷题执行引擎 (Worker Engine)                │
 │   - Problem Fetcher: 根据策略检索题目元数据及样例            │
 │   - AI Solution Engine: 结合 CoT 与历史错误生成代码          │
 │   - Local Sandbox: 一次性隔离环境运行测试 (详见 docs/06)     │
 │   - Submitter & Verifier: 接口提交与结果提取 (可替换, 见 01) │
 │   - Solution Doc Archiver: AC 后自动生成 Markdown 题解       │
 └─────────────────────────────────────────────────────────────┘
```

# 2. 职责与单一写入者原则

* **Control Server 是唯一的持久化写入点**。Worker Engine 不直接写数据库，一律通过执行事件回调上报，由 Control Server 的 Repository 层落库。避免双写竞争，也让状态机成为唯一的"事实来源"。
* **WebSocket 广播源**是 Control Server：它消费 Worker 事件与状态机变更，统一编号后广播（事件契约见 [10-data-protocols.md](10-data-protocols.md)）。
* **对外请求收敛**：所有对 LeetCode 的 HTTP 请求（探针、取题、详情、提交）都经过 Auth Manager 的同一限速队列，保证全局串行与最小间隔（限频硬顶见 [01-goals-scope-risk.md](01-goals-scope-risk.md)）。

# 3. 生命周期与崩溃恢复

* **优雅停机**：收到 `SIGTERM` / Halt 指令后按软暂停语义处理——当前题目流程跑完、状态与上下文持久化、然后退出。**绝不中途丢弃一道正在进行的题**。
* **崩溃恢复**：状态机状态、当前任务上下文、预算计数器均持久化于 `runtime_state`（表定义见 [10-data-protocols.md](10-data-protocols.md)）。进程重启后：
  * 恢复到崩溃前的稳定状态（IDLE / PAUSED / BLOCKED 等待人工；RUNNING 类状态回到 RUNNING 并重新校验 Cookie）。
  * 崩溃时处于 `IN_PROGRESS` 的题目标记为 `interrupted`，其代码快照保留供审查，题目回队列头部重跑。
  * 冷却锚定于"最后一次真实提交时间戳"（机制见 [04-auth-risk.md](04-auth-risk.md)），恢复后无需额外记账。

---

> 导航：[索引](../spec.md) · 上一节：[01-goals-scope-risk.md](01-goals-scope-risk.md) · 下一节：[03-state-machine.md](03-state-machine.md)
