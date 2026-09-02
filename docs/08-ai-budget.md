---
title: LLM 调用与成本预算 (AI Budget Manager)
related: [06-sandbox-self-heal.md, 04-auth-risk.md, 10-data-protocols.md]
source: v0.2 §3.6
---

# 1. 计量

每次 LLM 调用记录 `token_in` / `token_out` / 模型名，归属到 `attempts` 记录（表定义见 [10-data-protocols.md](10-data-protocols.md)）。调用场景包括：初始代码生成、self-debug、失败反思（复杂度/健壮性）、题解生成（见 [06-sandbox-self-heal.md](06-sandbox-self-heal.md) 与 [07-archiver.md](07-archiver.md)）。

# 2. 单题预算

默认 ≤ 8 次调用（初始生成 1 + self-debug ≤ 4 + 失败反思 + 题解生成 1~2）；超限即 `skipped`（终态定义见 [03-state-machine.md](03-state-machine.md)）。

# 3. 全局预算

每日 token/费用上限（可配置）：

* 用量 ≥ 80%：广播 `budget_warning` 告警（L1 提醒，见 [04-auth-risk.md](04-auth-risk.md)）；
* 用量 100%：进入 `PAUSED` 等待人工恢复（L2 软停），**不允许**自动重置恢复。

---

> 导航：[索引](../spec.md) · 上一节：[07-archiver.md](07-archiver.md) · 下一节：[09-dashboard.md](09-dashboard.md)
