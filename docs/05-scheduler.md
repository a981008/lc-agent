---
title: 刷题策略调度器 (Strategy Scheduler)
related: [03-state-machine.md, 04-auth-risk.md, 06-sandbox-self-heal.md]
source: v0.2 §3.3
---

# 1. 选题模式

前端提交策略参数，调度器在每次取题时执行筛选过滤：

1. **随机模式 (Random)**：
   * 在系统未 AC 的全量题目列表中，排除 `paid_only = true` 的 Premium 锁卡题后随机抽取。

2. **顺序模式 (Sequential)**：
   * 以 **slug** 为稳定主序依据递增检索（`frontend_question_id` 仅作展示——LeetCode 的前端题号与题目顺序会漂移，slug 才稳定）。
   * 自动跳过已 AC、已 `skipped`（冷却期内）与 `paid_only` 题目。

3. **指定题型/标签模式 (Tag & Difficulty Filter)**：
   * 支持多维组合筛选：例如 `Tag = [Dynamic Programming]` + `Difficulty = [Medium]`。

# 2. 队列优先级（高 → 低）

1. `interrupted` 回炉题（崩溃恢复，见 [02-architecture.md](02-architecture.md)）
2. 失败重试题（`skipped` 冷却期满，携带历史失败上下文）
3. 按当前模式筛选出的新题

题目生命周期与 `skipped` / `accepted` 终态定义见 [03-state-machine.md](03-state-machine.md)；失败上下文的产生机制见 [06-sandbox-self-heal.md](06-sandbox-self-heal.md)。

# 2.5 每日一题自动完成

* 开关 `limits.dailyChallenge.enabled`（默认开，面板「运行参数」可切换）。
* 引擎启动 90s 后首查，之后每 20min 轮询 leetcode.cn 官方 `todayRecord` GraphQL（免凭据）识别当日每日一题。
* 触发即走完整单题流水线（生成 → 沙盒 → 提交 → 多解法 → 翻译 → 归档），**计入每日提交配额**。
* 幂等：触发即落 `runtime_state` 键 `daily:done:<本地日期>`；已 AC 直接标记完成、付费题跳过、配额不足或状态忙碌时延后到下一轮。
* 手动补跑：`POST /api/admin/daily-challenge`，body `{"force":true}` 可绕过忙状态立即检查。

# 3. 失败熔断参数（可配置默认值）

* 单题最多 **2 次**真实提交（首次 + 1 次修正）；本地 self-debug 最多 **4 轮**。
* 任一上限触发即标记 `skipped`（记录 `skip_reason`），进入冷却期，调度器换下一题。**严禁无限重试单题。**

---

> 导航：[索引](../spec.md) · 上一节：[04-auth-risk.md](04-auth-risk.md) · 下一节：[06-sandbox-self-heal.md](06-sandbox-self-heal.md)
