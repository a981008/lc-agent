# LC-Agent — 全自动 LeetCode 机器人系统技术规格 (Spec v0.3)

> 本文件是**总索引与导航**，不含实现细节。各模块规格位于 `docs/`，按需加载。
> 人类建议按序通读；Agent 建议按下方「任务路由」定点加载。

## 1. 系统一句话定位

托管于服务器的 24 小时无人值守刷题与监控平台：**前端可视化控制台 + 后端异步任务引擎 + 本地沙盒 + AI 大模型**，全 JS/TS 技术栈。四大核心诉求：

1. **控制自治**：随机/顺序/标签难度三种刷题模式，可暂停、恢复、单次触发。
2. **账号与风控感知**：Cookie 探针、分级熔断、锚定冷却与作息时间窗。
3. **本地防错闭环**：AI 代码先过隔离沙盒，提交报错回填用例库自愈。
4. **状态透明化**：REST 控制 + WebSocket 实时推送状态、进度与日志。

→ 目标、范围与非目标、风险与合规对策详见 [docs/01-goals-scope-risk.md](docs/01-goals-scope-risk.md)

## 2. 全局硬约束（任何实现不得违反）

下表仅为速查，**权威定义以链接文档为准**（单一事实来源原则）：

| # | 约束 | 权威出处 |
|---|------|----------|
| 1 | 沙盒必须为一次性隔离环境：禁网、只读根文件系统、内存/CPU 双门限、非特权用户；禁止裸 `vm` 充当隔离 | [docs/06](docs/06-sandbox-self-heal.md) |
| 2 | 日志与任何接口禁止泄露 Cookie / CSRF Token / GitHub Token，统一强制脱敏 | [docs/10](docs/10-data-protocols.md) |
| 3 | 对 LeetCode 的出站请求全局串行、最小间隔 ≥ 5s；每日真实提交默认 ≤ 10 题 | [docs/01](docs/01-goals-scope-risk.md) |
| 4 | 单一写入者：仅 Control Server 的 Repository 层可写数据库 | [docs/02](docs/02-architecture.md) |
| 5 | 单实例、单账号、单并发（一次只跑一题） | [docs/01](docs/01-goals-scope-risk.md) |
| 6 | 单题重试上限：真实提交 ≤ 2 次、self-debug ≤ 4 轮，超限即 `skipped` | [docs/05](docs/05-scheduler.md) |
| 7 | LLM 预算：单题 ≤ 8 次调用；全局每日上限，用尽进入 `PAUSED` 待人工 | [docs/08](docs/08-ai-budget.md) |
| 8 | 面板默认开启鉴权并仅绑定 `127.0.0.1`；任何接口不得返回凭据原文 | [docs/09](docs/09-dashboard.md) |

## 3. 文件地图

| 文件 | 主题 | 何时读 |
|------|------|--------|
| [docs/01-goals-scope-risk.md](docs/01-goals-scope-risk.md) | 目标、范围与非目标、风险声明与合规对策 | 立项与评审前必读 |
| [docs/02-architecture.md](docs/02-architecture.md) | 三层架构、数据流、单一写入者、崩溃恢复 | 搭建骨架前 |
| [docs/03-state-machine.md](docs/03-state-machine.md) | 全局状态机、指令语义、单题生命周期 | 实现控制层前 |
| [docs/04-auth-risk.md](docs/04-auth-risk.md) | 账号探针、熔断分级、冷却模型、作息时间窗 | 实现风控前 |
| [docs/05-scheduler.md](docs/05-scheduler.md) | 选题策略、队列优先级、失败熔断参数 | 实现调度器前 |
| [docs/06-sandbox-self-heal.md](docs/06-sandbox-self-heal.md) | 沙盒安全模型、Driver 生成、失败分流、自愈闭环 | 实现沙盒前必读 |
| [docs/07-archiver.md](docs/07-archiver.md) | 题解生成与 Git 幂等归档 | AC 后流程 |
| [docs/08-ai-budget.md](docs/08-ai-budget.md) | LLM 计量与成本预算 | 接入模型前 |
| [docs/09-dashboard.md](docs/09-dashboard.md) | 面板布局、断线回放、安全基线 | 实现前端前 |
| [docs/10-data-protocols.md](docs/10-data-protocols.md) | REST/WS 事件契约、数据库 Schema | 实现存储与接口前 |
| [docs/11-milestones.md](docs/11-milestones.md) | 里程碑与验收标准 | 制定排期时 |
| [docs/changelog.md](docs/changelog.md) | 修订记录 | 追溯变更时 |

## 4. 阅读路径

### 4.1 人类：顺序通读

`01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11`

其中 **01、02、06** 是理解系统的最小闭环，时间有限可先读这三篇。

### 4.2 Agent：按任务路由

| 任务 | 必读 | 参考 |
|------|------|------|
| 总体理解 / 项目骨架 | 01, 02 | 11 |
| 状态机与控制 API | 03, 04 | 10 |
| 调度器与题目队列 | 05, 03 | 04 |
| 沙盒与自愈闭环 | 06 | 08, 10 |
| 提交与题解归档 | 07, 10 | 06 |
| LLM 接入与预算 | 08 | 06 |
| 前端面板 | 09, 10 | 03 |
| 存储与通讯协议 | 10 | 02 |
| 风控与熔断 | 04, 01 | 03 |

（「必读」以完成该任务为前提；涉及全局硬约束时，另读 §2 表中对应文档。）

## 5. 术语表

| 术语 | 含义 |
|------|------|
| verdict | 判题结果：AC（通过）/ WA（答案错误）/ TLE（超时）/ RE（运行时错误） |
| BLOCKED | 系统熔断态（Cookie 失效 / CAPTCHA / 锁定），人工确认后才可恢复 |
| PAUSED | 用户主动暂停态；与 BLOCKED 严格区分 |
| COOLING | 冷却等待态，计时锚定于最后一次真实提交的时间戳 |
| skipped | 单题重试超限后的题目级终态；冷却期（默认 7 天）满后可重新入队 |
| accepted | 题目级终态：已通过 |
| self-debug | AI 基于本地沙盒报错对代码进行的多轮自我修复循环 |
| driver | 由题目元数据（code definition）自动生成的序列化/反序列化脚手架 |
| 冷却锚定 | 冷却通过比较 `last_submit_at` 时间戳实现，暂停/重启天然继承 |
| slug | LeetCode 题目的稳定英文标识，作为顺序模式的主序依据 |
| paid_only | Premium 锁卡题标记，全模式一律排除 |
| 单一写入者 | 仅 Control Server 落库；Worker 只上报事件 |
| 软暂停 / 软化 | 控制指令不打断进行中的题目流程，待其结束后生效 |
| interrupted | 崩溃时处于 IN_PROGRESS 的题目标记，回队列头部重跑 |

## 6. 文档约定

* 每个模块文档的 YAML frontmatter 含 `related`（建议同读）与 `source`（对应 v0.2 版本章节，便于追溯）。
* 跨文件引用一律使用相对链接；本索引只做导航与速查，**实现细节只存在于 `docs/` 对应文件**。
* 文中数值（冷却时长、配额、重试上限等）均为**默认值，可配置**；「如 / 默认」字样即默认值。
* `BLOCKED` 与 `PAUSED` 语义严格不同，见术语表。
