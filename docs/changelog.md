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
| v0.25 | **修复服务器沙盒全挂的根因**：沙盒工作目录由 `mkdtempSync` 创建（默认 0700），容器却固定 `--user 1000:1000`——宿主用户 uid ≠ 1000 的服务器上容器无法遍历目录，node 无症状崩溃（`2 用例，失败 0` 但整体失败）；改为容器身份跟随宿主运行者（动态 uid:gid）+ 工作目录显式 0755。本机 uid 恰为 1000 掩盖了此 bug |
| v0.26 | **题库同步改为每晚 0 点**：重启不再全量同步题库——仅建库为空时立即同步、距上次同步 ≥24h 才延迟 1 分钟补同步；每晚本地 0 点定时自动同步；面板手动同步按钮保留；lastSyncAt 落库 |
| v0.27 | **翻译语言全量支持**：`translateLangs` 支持 `['all']`——按题目实际提供的语言全量翻译提交（leetcode.cn 全 20 种：C/C++/Java/Python3/C#/JS/TS/Go/Kotlin/Swift/Rust/Ruby/PHP/Dart/Scala/Elixir/Erlang/Racket/仓颉）；显式列表按站点交集解析；修复 Go 的 slug（`go`→`golang`，旧配置自动归一化）；语言名标签补全；「运行参数」新增「全部」选项 |
| v0.28 | **题解代码高亮与一键复制**：AC 代码页签接入 highlight.js（20 种语言按需注册，按语言着色，无对应实现的降级纯文本）；页签栏新增「⧉ 复制全部」——一次复制所有语言代码（带语言名注释头，按语言用 `//`/`#`/`--` 正确注释；HTTP 环境自动回退 execCommand），按钮反馈「✓ 已复制」 |
| v0.29 | **策略与题目状态改造**：①策略去掉「指定 slug」输入（题目列表点选「跑这题」不受影响）；②「跑单题」未指定 slug 时改为**随机一题**（仍受难度/知识点过滤约束）；③标签模式改为 **LC 官方知识点下拉**（数组/哈希表/链表/双指针/动态规划等 26 项，中文标签对应站点 slug）；④题目列表状态列改为三态徽章：**待完成 / 尝试过 / 已解答**；⑤getQuestion 查询补 topicTags，点选未同步题目时标签一并入库 |
| v0.30 | **题解列表自动刷新**：WS 事件驱动——归档完成（`archive done`）即时刷新 AC 题解列表；单题结束（IN_PROGRESS → IDLE/COOLING）即时刷新题目列表（尝试数与三态状态同步更新），无需手动切页签 |
| v0.30 | **提交配额支持无限制**：「运行参数」新增「无限制」勾选（存 `dailySubmitLimit=0`）；后端配额判定统一走 `quotaReached()`（0 视为不限制），4 处判断同步；负数输入回退默认 10，自测 59/59 |
| v0.32 | **翻译语言动态化 + 选择器美化**：新增 `GET /api/languages`——从 LC 官方 `languageList` 动态获取全部提交语言（26 种，24h 服务端缓存 + 失败时回退上次列表），前端不再写死；「运行参数」语言选择改为 chip 药丸网格（选中高亮、全部置顶绿显、悬停反馈）；修复匿名 GraphQL 查询带 operationName 被 cn 拒绝的问题 |
| v0.33 | **构建健壮性**：`npm run web:build` 自动先安装 `web/` 依赖再构建——git pull 拉到新前端依赖（katex/highlight.js 等）后直接构建不再报 `Rollup failed to resolve import` |
| v0.34 | **UI 对齐 LeetCode 风格 + 双主题**：全部颜色改为 CSS 令牌，品牌橙 `#FFA116` 点缀（按钮/链接/页签/选中态），LC 三色难度（绿/金/红）；顶栏新增主题切换 ☀️ 浅色 / 🌙 深色 / 💻 跟随系统（`prefers-color-scheme` 实时响应，localStorage 持久化，首屏内联脚本防闪烁）；语法高亮配色改为内置双主题（One-Dark/One-Light），去掉静态 github-dark |
| v0.35 | **静态资源缓存策略修复 + 版本号显示**：`/assets/*`（内容哈希文件名）长缓存 `immutable`，入口 `index.html` 改 `no-cache` 每次回源——部署后普通刷新即可见新界面，不再出现 304 旧页面；`/api/status` 新增 `uiVersion`（取 changelog 最新版本），顶栏显示版本徽章，部署是否生效一眼可辨 |
| v0.36 | **白屏自愈**：入口页内联自检——页面加载 2.5s 后 `#app` 仍为空（旧入口引用已下线的哈希资源导致 404 白屏）则自动整页刷新一次拿新入口（sessionStorage 防循环）；已缓存的旧页面用户无需手动强刷 |
| v0.37 | **修复白屏根因**：v0.32 一次半截的脚本替换导致 `store.js` 里 `loadLanguages` 定义与 `languages` 初始字段丢失——运行时 `ReferenceError` 使 Vue 整页挂载失败（白屏）；已恢复定义并用 CDP 真实浏览器回归（topbar/表格/27 语言 chip/主题切换/无运行时异常全过） |
| v0.38 | **列表检索 + 去掉跑单题**：题目列表新增检索工具条（题号/标题/slug 关键词、三态状态、难度多选、LC 知识点分类，服务端全库过滤而非当前页过滤）；AC 题解列表新增检索（题号/标题关键词、难度、分类）；控制台移除「⚡ 跑单题」按钮与「指定 slug」输入（题目列表「▶ 跑这题」保留） |

---

> 导航：[索引](../spec.md) · 上一节：[11-milestones.md](11-milestones.md)
