---
title: 账号监控与风控 (Auth & Risk Manager)
related: [03-state-machine.md, 01-goals-scope-risk.md, 10-data-protocols.md]
source: v0.2 §3.1
---

# 1. 账号状态探针

* 后台按固定周期（默认 30 分钟，±5 分钟随机抖动）向 LeetCode 鉴权接口发起轻量探针。探针本身也是可指纹化的请求，必须抖动。
* 状态映射：`Authenticated`（已登录）、`Session Expired`（Cookie 失效）、`Challenged`（触发 CAPTCHA 人机验证）。
* 状态变为 `Session Expired` 或 `Challenged` 时，系统**强行熔断**进入 `BLOCKED` 状态（与用户手动暂停的 `PAUSED` 严格区分，见 [03-state-machine.md](03-state-machine.md)），通过 WebSocket 与第三方通知告警。

# 2. 熔断分级与恢复路径

| 级别 | 触发条件 | 动作 | 恢复方式 |
|------|----------|------|----------|
| L1 提醒 | 预算用量 ≥ 80%、push 失败等软异常 | 广播告警，不停止运行 | 自动 |
| L2 软停 | 每日提交配额耗尽、LLM 硬预算耗尽 | 进入 `PAUSED`，等待人工恢复 | 面板确认 |
| L3 熔断 | `Session Expired` / `Challenged` | 进入 `BLOCKED`，停止一切对 LC 请求 | 面板更新 Cookie 并**人工确认** |
| L4 停机 | 单日 CAPTCHA ≥ 2 次 | 进入 `BLOCKED` 并锁定 24h | 锁定到期 + 人工确认 |

* `BLOCKED → IDLE` 的**唯一途径**是人工在前端更新凭据并确认恢复。不存在任何自动恢复路径，防止带着失效 Cookie 空转。
* L1/L2 对应的预算机制见 [08-ai-budget.md](08-ai-budget.md)。

# 3. 冷却模型（锚定式）

* 每完成**一次**真实提交（无论 AC/失败），记录 `last_submit_at`（持久化于 `runtime_state`，见 [10-data-protocols.md](10-data-protocols.md)）。
* 取题前若 `now - last_submit_at < cooldown`，进入 `COOLING` 等待。
* `cooldown` 服从正态分布：μ = 7 分钟，σ = 2 分钟，**截断至 [3, 12] 分钟**（参数可配置）。锚定时间戳的设计使暂停/恢复/崩溃恢复天然继承冷却，无需单独记账。
* Self-debug 与本地沙盒运行是**纯本地行为**，不触发冷却。

# 4. 请求速率与作息模拟

* 全站请求串行 + 最小间隔（限频硬顶见 [01-goals-scope-risk.md](01-goals-scope-risk.md)）；拉取全量题目列表属重请求，仅在首次同步与每日增量同步时执行。
* **运行时间窗**（可配置，如 08:00–24:00）：窗外自动转入 `PAUSED`（夜间休眠），到点自动唤回。系统宣称"24 小时无人值守"指**无需人工干预**，而非 24 小时不间断提交。

---

> 导航：[索引](../spec.md) · 上一节：[03-state-machine.md](03-state-machine.md) · 下一节：[05-scheduler.md](05-scheduler.md)
