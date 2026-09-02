---
title: 修订记录
related: [11-milestones.md]
source: v0.2 §7
---

# 修订记录

| 版本 | 变更摘要 |
|------|----------|
| v0.1 | 初稿：三层架构、状态机、沙盒闭环、面板与 Schema 骨架 |
| v0.2 | 评审修订：新增风险声明与合规对策（§1.2）、沙盒安全模型（§3.4.1）、`BLOCKED` 熔断态与恢复路径（§3.1/§3.2）、失败分流 WA/TLE/RE（§3.4.3）、Driver 元数据生成（§3.4.2）、`attempts`/`runtime_state` 表与加密要求（§5.2）、事件契约与可靠补发（§5.1）、LLM 预算（§3.6）、锚定式冷却与运行时间窗（§3.1）、指令生效语义（§3.2）、Dashboard 鉴权基线（§4）、里程碑与验收（§6） |
| v0.3 | 文档结构重构：单文件拆分为「索引 `spec.md` + `docs/` 下 12 个模块文档」；新增全局硬约束速查、术语表、人类/Agent 双阅读路径与任务路由、每篇 frontmatter（`related` / `source`）与文末导航。内容语义与 v0.2 保持一致，原章节号记录于各篇 `source` 字段，跨文件引用改为相对链接 |
| v0.4 | 实现落地与真实账号验收（leetcode.cn）：面板前端由原生 JS 重写为 **Vue 3**（vendored ESM 浏览器版，保持无构建）；LLM 客户端支持 **Anthropic Messages 协议**（`/v1/messages`，thinking/text 块分离）；判题链路适配 cn 站（`SUCCESS` 完成态、`status_runtime` 时长、`exampleTestcases` 行拼接格式、`isSignedIn` 探针、`problemsetQuestionList` 题单）；`problem_id` 统一为 frontendQuestionId；Trigger Once 状态迁移修复；新增离线判题回执形态回归自测 |
| v0.5 | 前端迁移为 **标准 Vue 工程**（Vite + SFC 组件化，`web/` 独立 package.json，12 个组件 + reactive store；`web/dist` 由后端服务，dev 模式 Vite 代理 `/api`、`/ws`）；新增启停脚本 `lc.sh`（start/stop/restart/status/logs，优雅停机，自动构建前端） |
| v0.6 | **多语言翻译与提交**：JS AC 后自动翻译为 `limits.translateLangs`（默认 python3/cpp/java）并逐个真实提交、判题（每语言 ≤2 次提交，AI 修复可介入；单语言失败不阻塞归档）；`attempts` 新增 `lang` 列、`solutions` 新增 `codes` 列（存量库自动迁移）；题解 AC 代码改为**多语言页签**（`ac-tabs` 约定块 + 前端渲染器 + 事件委托）；管线新增 `translate` 阶段；题解 LLM 生成不再包含代码块 |
| v0.7 | **题解渲染修复**：Markdown 渲染从手写正则迁移到 **marked**（GFM 表格/有序无序列表/任务清单/引用完整支持，题解中的对比表格不再显示为裸管道文本）；保留 `ac-tabs` 多语言页签约定；原始 HTML 一律转义防注入，链接协议白名单（http/https/mailto），补齐 `.md` 表格与列表样式 |
| v0.8 | **冷却可配置 + 面板倒计时**：冷却 min/max（分钟）可在「运行参数」配置（μ/σ 深合并保留，`mergeLimits` 数值清洗、min>max 自动交换；修改对已锚定的冷却**即时生效**）；面板顶部 CD 以 `cooldownEndsAt` 锚定、**每秒本地刷新**（m:ss，无需轮询）；修复浅合并缺陷（此前仅保存 enabled 会丢 μ/σ/min/max 导致冷却失效） |

---

> 导航：[索引](../spec.md) · 上一节：[11-milestones.md](11-milestones.md)
