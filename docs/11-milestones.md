---
title: 里程碑与验收标准
related: [02-architecture.md, 06-sandbox-self-heal.md, 09-dashboard.md, 10-data-protocols.md]
source: v0.2 §6
---

# 1. 里程碑

| 里程碑 | 范围 | 验收标准 |
|--------|------|----------|
| **M1 骨架跑通** | 状态机 + REST/WS + 手动单题全流程（仅样例测试，无自愈） | 手动触发一次，从抓取到提交/失败入库全程可在面板观测 |
| **M2 自愈闭环** | Driver 生成器（链表/二叉树/数组）+ WA 回填 + self-debug + `attempts` 表 | 注入一个必然 WA 的场景，系统能本地修复并二提通过 |
| **M3 调度与风控** | 三种策略、锚定冷却、BLOCKED 熔断、预算、运行时间窗 | 拔掉 Cookie 系统进入 `BLOCKED` 并告警；恢复需人工确认 |
| **M4 面板与归档** | 鉴权、日志回放、题解渲染、Git 幂等同步 | 断网重连后日志可回放；AC 后 GitHub 可见对应提交，push 失败可补推 |

# 2. 不可妥协项

每个里程碑交付时，以下两项为**验收前置条件**，不满足则整体验收不通过：

* **沙盒安全基线**（见 [06-sandbox-self-heal.md](06-sandbox-self-heal.md) §2）；
* **日志与接口脱敏**（见 [10-data-protocols.md](10-data-protocols.md) §2）。

---

> 导航：[索引](../spec.md) · 上一节：[10-data-protocols.md](10-data-protocols.md) · 下一节：[changelog.md](changelog.md)
