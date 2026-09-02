---
title: 全局状态机与运行控制
related: [02-architecture.md, 04-auth-risk.md, 05-scheduler.md, 06-sandbox-self-heal.md, 10-data-protocols.md]
source: v0.2 §3.2
---

# 1. 全局状态机

系统全局维护一个**单例状态机**，含 `BLOCKED` 熔断态，与用户主动的 `PAUSED` 严格区分：

```
          [ 启动系统 / 崩溃恢复 ]
                  │
                  v
           ┌───────────┐   Resume (距上次提交不足冷却则先经 COOLING)
           │    IDLE   │ ──────────────────────────────┐
           └─────▲─────┘                               v
                 │                             ┌──────────────┐ 取题冷却 ┌───────────┐
                 │ 终止指令                     │   RUNNING    │ ───────> │  COOLING  │
                 │ (软化至当前题结束)           └──┬───────▲───┘          └─────┬─────┘
                 │                    启动单题流程 │       │ 冷却到期(锚定)      │
                 │                                v       └────────────────────┤
                 │                         ┌──────────────┐ 本题流程结束         │
                 │                         │ IN_PROGRESS  │ ─────────────────────┘
                 │                         └──────┬───────┘ (无挂起暂停指令)
                 │                                │ 本题流程结束(有挂起暂停指令 → 直接 PAUSED)
                 │                                v
           ┌───────────┐   暂停指令: RUNNING/COOLING 立即生效, IN_PROGRESS 挂起到本题结束
           │  PAUSED   │ <──────────────────────────────────────────────────────
           └─────┬─────┘
                 │  熔断(任意运行态): Cookie失效 / CAPTCHA / L4 锁定
                 v
           ┌───────────┐   人工更新凭据 + 面板确认
           │  BLOCKED  │ ────────────────────────────────────────> IDLE
           └───────────┘
```

# 2. 状态迁移表（权威定义，图示仅示意）

| # | 源状态 | 事件 | 目标状态 | 语义 |
|---|--------|------|----------|------|
| 1 | IDLE | Resume | RUNNING / COOLING | 唤醒循环；冷却未满先进 COOLING |
| 2 | RUNNING | 取题请求 | COOLING | 距 `last_submit_at` 不足冷却间隔 |
| 3 | COOLING | 冷却到期 | RUNNING | 锚定时间戳比较 |
| 4 | RUNNING / COOLING | 取题就绪 | IN_PROGRESS | 启动单题全流程 |
| 5 | IN_PROGRESS | 本题流程结束（AC / skipped） | COOLING | 无论结果如何，锚定冷却 |
| 6 | IN_PROGRESS | 本题流程结束 + 有挂起暂停指令 | PAUSED | 软暂停吞并本次冷却 |
| 7 | RUNNING / COOLING | 暂停指令 | PAUSED | 未跑题时**立即**生效 |
| 8 | PAUSED | Resume | RUNNING / COOLING | 冷却未满则先经 COOLING |
| 9 | 任意运行态 | 熔断 L3 / L4（分级定义见 [04-auth-risk.md](04-auth-risk.md)） | BLOCKED | 停止一切对 LC 请求并告警 |
| 10 | BLOCKED | 人工更新凭据 + 确认 | IDLE | 唯一恢复路径 |
| 11 | 任意状态 | 终止指令 (Halt) | IDLE | 软化：IN_PROGRESS 时待本题结束 |

# 3. 指令响应策略

* **Pause (暂停)**：软暂停。引擎正在跑某道题（`IN_PROGRESS`）时，暂停指令被**挂起**，允许当前题目运行完毕后进入 `PAUSED`，不再调起下一题；未跑题时立即生效。
* **Resume (恢复)**：唤醒状态机重新进入 `RUNNING` 循环；对 `BLOCKED` 无效。
* **Trigger Once (单次运行)**：在 `IDLE` 或 `PAUSED` 状态下，仅执行单道题目的全流程，执行完毕后自动归位原状态。
* **指令生效语义**：策略参数修改**下一题生效**——当前题目流程使用其取题时刻的策略快照，运行中不受改参影响，避免中途换规则的脏状态。

# 4. 单题生命周期（题目级状态，独立于全局状态机）

```
queued → fetching → generating → local_testing ─(全通过)→ submitting ─(AC)→ accepted
                          ▲             │(失败)                   │(WA/TLE/RE)
                          │             v                         v
                          └──── self-debug 循环 (≤4 轮) ──── 失败分流（见 06 文档）
                                                                  │ 超限
                                                                  v
                                                               skipped
```

`accepted` 与 `skipped` 是仅有的两个终态。`skipped` 的题目默认 7 天后方可重新入队（可配置），防止反复死磕。失败分流规则（WA / TLE / RE 各走不同路径）见 [06-sandbox-self-heal.md](06-sandbox-self-heal.md)；重试上限的配置见 [05-scheduler.md](05-scheduler.md)。

# 5. 状态持久化

状态机每次迁移写入 `runtime_state`（表定义见 [10-data-protocols.md](10-data-protocols.md)）并广播 `state_change` 事件（契约见 [10-data-protocols.md](10-data-protocols.md)）；崩溃恢复语义见 [02-architecture.md](02-architecture.md)。

---

> 导航：[索引](../spec.md) · 上一节：[02-architecture.md](02-architecture.md) · 下一节：[04-auth-risk.md](04-auth-risk.md)
