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
| v0.9 | **LeetCode 原题链接**：题目列表/AC 题解的题目列变为外链（新窗口打开 leetcode.cn 题目页）；归档题解首个标题后自动插入 `原题链接` 引用块（幂等，回退模板同样生效）；存量题解 66 已回填重建 |
| v0.10 | **满屏布局**：面板改为 `100vh` 三区结构（左控制面板 / 右上 Pipeline+实时日志 / 右下历史表格弹性填充），页面级滚动条消除（浏览器右侧无滚动轴），长列表改为面板内滚动（细暗色滚动条）；支持 `?token=` 一键登录（地址栏即抹除），启动时自动尝试恢复会话 |
| v0.11 | **配置标签页**：左侧控制面板的配置区拆分为「策略 / 凭据 / LLM / 参数」四个标签页（控制按钮常驻顶部；`v-show` 切换保留未保存输入） |
| v0.12 | **题目列表分页增强**：显示「当前页 / 总页数（共 N 题）」，每页条数可选 20/50/100（后端 `pageSize` 透传，上限 200；页越界自动回退最后一页；翻页按钮到边界置灰） |
| v0.13 | **CD 单位统一为秒**：顶栏倒计时直接显示总秒数（如 `330s`），「运行参数」最小/最大冷却改为秒（默认 180–720s）；修复 `mergeLimits` 缺陷——收缩 [min,max] 区间会把 μ 永久钳压（现 μ 保持原值，采样结果仍按区间截断） |
| v0.14 | **分页条常驻**：题目列表翻页条 `sticky` 钉在表格滚动区域底部，表格内滚动时翻页控件始终可见，无需滚到最下 |
| v0.16 | **部署文档**：新增 [`docs/12-deployment.md`](12-deployment.md)——`.env` 配置（BIND/ADMIN_TOKEN/SECRET_KEY/DRY_RUN）、前置依赖、systemd 常驻、nginx+WS 反代、备份迁移与上线检查清单 |
| v0.15 | **实时日志固定大小**：日志终端改为固定 260px 高度，不再随日志增多而变大；超出部分内部滚动（自动滚动到底），滚动条样式与列表一致 |
| v0.17 | **修复 .env 失效**：`env` 快照在 ESM import 阶段冻结，早于 `loadEnv()`，导致 `.env` 的 `BIND/PORT/SECRET_KEY/DATA_DIR/SANDBOX_IMAGE` 全部被忽略（日志恒显 127.0.0.1）；改为 getter 动态读取，访问时才取 process.env，并新增 2 项回归自测 |
| v0.18 | **LLM 客户端加固**（跑题实战暴露）：① OpenAI 协议下推理模型只回 `reasoning_content` 时兜底取用；② 两种协议统一为思考预留 +12000 输出预算；③ 请求超时 180s→420s（长思考不再中断）。另实测定位「假 WA」之谜：面板保存会以页面快照覆盖 API 侧 dryRun，DrySubmitter 的假回执（30/58、expected=[0,1]）会经 WA 回填污染本地用例库 |
| v0.19 | **题解数学公式渲染**：接入 KaTeX——`$…$` 行内 / `$$…$$` 块级（marked 扩展 tokenizer，先于默认规则吃掉数学式，`_`/`^`/`\` 不再被 markdown 搅乱；代码块内与未配对 `$`（如金额）不误判；非法式子降级红色原文） |
| v0.20 | **排查增强**：`local_fail` 尝试记录的 detail 补充 `exit` 与 `stderr` 尾部——沙盒整体失败（docker 报错/超时/崩溃）时面板与库里可直接看到根因，不再只有笼统的 `sandbox_error` |
| v0.21 | **题目列表一键跑题**：每行新增「▶ 跑这题」按钮（Trigger Once，等价手输 slug）；仅 IDLE/PAUSED 可点（忙时按钮禁用，后端 409 兜底）；付费题禁用；当前运行中的题整行高亮 + 按钮变「⏳ 运行中」 |
| v0.22 | **LLM 网络错误可诊断**：`fetch failed` 展开底层 cause 链（`ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT`…）写进日志与尝试记录，服务器上不再只有无信息量的笼统报错 |
| v0.23 | **LLM 请求自动重试**：网络级瞬时抖动（ENOTFOUND/ECONNRESET/套接字中断）自动重试 1 次（间隔 2s）——单次抖动不再废掉整题的生成与本地预检；超时/中断不重试 |
| v0.24 | **SELinux 服务器兼容**：沙盒卷挂载加 `z` 标签（`--selinux-enabled` 的主机上容器内读取挂载文件会 Permission denied，导致 `local_fail sandbox_error`「用例 0 失败但整体失败」；无 SELinux 的主机该选项被忽略，行为不变） |

---

> 导航：[索引](../spec.md) · 上一节：[11-milestones.md](11-milestones.md)
