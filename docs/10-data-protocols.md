---
title: 数据存储与通讯协议
related: [02-architecture.md, 09-dashboard.md, 06-sandbox-self-heal.md, 03-state-machine.md, 04-auth-risk.md]
source: v0.2 §5（含 §5.1、§5.2）
---

# 1. REST API (HTTP)

用于前端触发控制指令、读取历史数据。全部端点需通过鉴权中间件。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/control/pause` `resume` `trigger-once` `halt` | POST | 运行控制指令（语义见 [03-state-machine.md](03-state-machine.md)） |
| `/api/control/strategy` | POST | 策略更新（下一题生效） |
| `/api/auth/cookie` | POST | 人工更新凭据并确认（解除 `BLOCKED` 的唯一途径） |
| `/api/status` | GET | 状态机、账号状态、预算用量、当前题目 |
| `/api/problems` | GET | 分页题目列表与生命周期状态 |
| `/api/solutions/:id` | GET | 单篇 Markdown 题解 |
| `/api/logs` | GET | 按 `since_seq` 回放历史日志 |

# 2. WebSocket 与事件契约

用于后端向前端**单向实时广播**。所有消息使用统一信封：

```
{ "type": "<事件类型>", "seq": <单调递增序号>, "ts": <时间戳>, "payload": { ... } }
```

**事件契约**：

| 事件类型 | payload 字段 | 说明 |
|----------|--------------|------|
| `state_change` | `from`, `to`, `reason` | 状态机迁移 |
| `pipeline_step` | `problem_id`, `slug`, `stage`, `status`, `detail` | `stage ∈ fetch / generate / local_test / submit / archive` |
| `log_stream` | `level`, `text` | **禁止包含** Cookie / CSRF / GitHub Token（统一脱敏过滤器强制生效） |
| `attempt_result` | `problem_id`, `verdict`, `runtime_ms`, `memory_percentile` | 每次真实提交的回执 |
| `budget_warning` | `scope`, `used`, `limit` | L1 预算告警（见 [04-auth-risk.md](04-auth-risk.md)） |

**可靠补发**：客户端重连时携带 `last_seq`，服务端从内存环形缓冲补发缺口；缺口超出缓冲容量时，提示客户端改用 `GET /api/logs?since_seq=` 回放。前端交互见 [09-dashboard.md](09-dashboard.md)。

# 3. 数据持久化 Schema

**选型定案：SQLite**（单机、单写入者、单人使用，足够可靠；建表时保持与 PostgreSQL 兼容的字段类型，以便未来平滑迁移）。Cookie 与令牌等敏感字段落库前**加密**，密钥仅来自环境变量，不入库、不入日志。

1. **`account_session`**：
   * 存储 Cookie（**加密存储**）、CSRF Token（加密）、最后一次探针状态、最后活跃时间。

2. **`problem_records`**：
   * `problem_id`、`frontend_question_id`、`slug`（唯一）、`title`、`difficulty`、`tags` (JSON)、`paid_only` (Bool)、`ac_status` (Bool)、`lifecycle` (`queued / accepted / skipped / unsupported`)、`skip_reason`、`retry_after`、`attempts_count`（尝试次数）。

3. **`test_cases_store`**：
   * 存储每道题目的本地测试用例，包含抓取的初始样例，以及**从 LeetCode 报错中动态追加的输入/输出对**；记录 `source` (`sample / lc_failure / manual`) 与 `truncated` 标志（截断用例只用于回归提示，不作为正确性依据）。

4. **`attempts`**（AI 循环调试的核心依据）：
   * `attempt_id`、`problem_id`、`round`、`code_snapshot`（每次提交的完整代码快照）、`verdict`、`error_digest`、`token_in`、`token_out`、`created_at`。
   * 无此表则 AI 自愈过程不可复盘（闭环见 [06-sandbox-self-heal.md](06-sandbox-self-heal.md)）：只存 AC 结果会让失败上下文全部丢失。

5. **`solutions`**：
   * 关联 `problem_id`，存储生成的 Markdown 题解内容、执行用耗时百分比、Git commit SHA、`push_status` (`pending / pushed / failed`)（补推机制见 [07-archiver.md](07-archiver.md)）。

6. **`runtime_state`**（崩溃恢复依据）：
   * `key` (PK)、`value` (JSON)、`updated_at`。持久化内容：状态机当前状态（见 [03-state-machine.md](03-state-machine.md)）、当前任务上下文、`last_submit_at` 冷却锚点（见 [04-auth-risk.md](04-auth-risk.md)）、每日预算计数器（见 [08-ai-budget.md](08-ai-budget.md)）、熔断锁定到期时间。

---

> 导航：[索引](../spec.md) · 上一节：[09-dashboard.md](09-dashboard.md) · 下一节：[11-milestones.md](11-milestones.md)
