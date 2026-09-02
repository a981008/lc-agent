---
title: 题解生成与知识归档 (Solution Archiver)
related: [08-ai-budget.md, 10-data-protocols.md, 06-sandbox-self-heal.md]
source: v0.2 §3.5
---

# 1. 触发条件与交付物

* **触发条件**：LeetCode 返回 `Status == Accepted`。
* **元数据提取**：抓取消耗时间、内存打败百分比（Percentile）。
* **输出交付物**：调用大模型生成标准 Markdown 文件，包含：
  * **题目概要与难度**
  * **核心解题思路（算法选型依据）**
  * **带注释的 AC 代码**
  * **时间/空间复杂度分析（LaTeX 表达）**
  * 附带本次求解的**尝试摘要**（自愈轮次、失败分流路径，数据来自 `attempts` 表，见 [10-data-protocols.md](10-data-protocols.md)），便于复盘。

# 2. 重复 AC 策略

同一题以更优解再次 AC 时，覆盖现文档并保留性能对比；历史版本由 Git 历史自然留存。

# 3. 归档持久化与 Git 幂等

* 写入本地磁盘/数据库（`solutions` 表，见 [10-data-protocols.md](10-data-protocols.md)），并触发 Git 自动化同步任务。
* Push 失败按指数退避重试 ≤ 3 次，仍失败则记入 `solutions.push_status = pending`，由后台任务**幂等补推**（commit 生成需幂等，避免重复提交）。

---

> 导航：[索引](../spec.md) · 上一节：[06-sandbox-self-heal.md](06-sandbox-self-heal.md) · 下一节：[08-ai-budget.md](08-ai-budget.md)
