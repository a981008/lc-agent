# 12 · 部署指南（服务器）

> 目标：在一台 Linux 服务器上长期运行 lc-agent。代码即仓库本身，部署 = Node 22 + Docker + 一份 `.env` + `./lc.sh start`。

## 1. 前置条件

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | **22**（必须） | `better-sqlite3` 原生模块按 Node 22 ABI 编译；`nvm use 22` 或系统包管理器安装。启动前 `node scripts/preflight.cjs`（已挂 prestart）会自检 |
| Docker | 可用且当前用户在 docker 组 | 沙盒隔离执行 AI 代码；首次运行自动构建 `lc-agent-sandbox:latest`（基于 node:22-slim，拉取失败自动切 daocloud 镜像源） |
| 编译工具链 | python3 / make / g++ | npm install 阶段编译原生模块用（多数发行版 `build-essential`） |
| 构建前端 | Node 22 + npm | `npm run web:build`；或本地构建好随代码携带 `web/dist/` |

```bash
git clone git@gitee.com:a981008/lc-agent.git && cd lc-agent   # 国内服务器走 gitee 快
npm install --cache ./.npm-cache
npm run web:build          # 若 web/dist 已随仓库携带可跳过
```

## 2. `.env` 配置（核心）

在项目根目录创建 `.env`（进程 env 优先于 .env）：

```dotenv
# 监听地址：默认 127.0.0.1 仅本机可访问。
#   服务器上有 nginx 反代 → 保持 127.0.0.1 即可；
#   直接对外 → 改 0.0.0.0（务必配合防火墙白名单，见 §5）
BIND=127.0.0.1
PORT=3081

# 面板访问 Token：不设则首次启动自动生成随机值（写在 data/dashboard-token.txt，权限 600）。
#   固定 token 便于书签/一键登录链接，务必用强随机值
ADMIN_TOKEN=换成你的强随机Token

# 凭据加密密钥（AES-256-GCM）：不设则自动生成 data/secret.key。
#   ⚠ 跨机器迁移/重装时必须带上 secret.key（或固定 SECRET_KEY），否则已存的 Cookie/LLM Key 解不开，需全部重新配置
SECRET_KEY=至少32位的随机字符串

# 数据目录（默认 ./data：SQLite 库 + secret.key + solutions/ + sandbox-tmp/），一般不改
# DATA_DIR=/var/lib/lc-agent

# 先跑模拟再放开：1=AI 真实生成、提交/判题走模拟，用于上线前链路验证
# DRY_RUN=1

# 沙盒镜像名（一般不动）
# SANDBOX_IMAGE=lc-agent-sandbox:latest
```

生成强随机值：`openssl rand -hex 24`。

## 3. 首次启动与凭据配置

```bash
./lc.sh start        # 守护进程启动；终端会打印 Dashboard Token
./lc.sh status       # 就绪探针（HTTP 200/401 即正常）
./lc.sh logs -f      # 跟踪日志（logs/server.log）
```

打开 `http://服务器IP:3081/?token=<Token>` 一键登录，在面板里配置（均加密落库）：

1. **凭据**：LEETCODE_SESSION + csrftoken（leetcode.cn）
2. **LLM**：协议 / baseUrl / 模型 / API Key
3. **参数**：冷却区间（秒）、每日配额、翻译语言

> ⚠ **机房 IP 风控**：数据中心 IP 调用 LeetCode 接口比家用宽带更容易触发 CAPTCHA/限流。系统遇到 `Challenged`/`Session Expired` 会自动熔断进 `BLOCKED`（单日 CAPTCHA ≥ 2 次锁 24h）。建议：先用 `DRY_RUN=1` 跑通，再放开；冷却与配额保持默认保守值。

## 4. systemd 常驻（推荐生产使用）

`/etc/systemd/system/lc-agent.service`：

```ini
[Unit]
Description=lc-agent
After=network-online.target docker.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/lc-agent
Environment=NODE_ENV=production
ExecStart=/home/deploy/.nvm/versions/node/v22.23.2/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now lc-agent
journalctl -u lc-agent -f
```

（或直接用 `./lc.sh start`，二选一。）

## 5. 反向代理与安全

nginx 示例（WebSocket 必须带 Upgrade 头）：

```nginx
server {
    listen 443 ssl;
    server_name lc.example.com;
    # ssl_certificate ...;

    location / {
        proxy_pass http://127.0.0.1:3081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # /ws 需要
        proxy_set_header Connection "upgrade";       # /ws 需要
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

安全清单：

- 面板只有一层 Token（localStorage / `?token=` 一键登录），**不要裸奔公网**：防火墙白名单来源 IP，或 nginx 叠加 basic_auth / IP 段限制
- `BIND=127.0.0.1` + nginx 是最稳妥的组合
- 端口 3081 若直接暴露，仅对可信 IP 开放

## 6. 备份与迁移

| 内容 | 位置 | 必要性 |
| --- | --- | --- |
| SQLite 库（题库/尝试/题解/配置） | `data/lc-agent.db` | 备份 |
| **凭据加密密钥** | `data/secret.key`（或 `SECRET_KEY`） | **必须**，丢了只能重新配置 Cookie/LLM |
| 归档题解 | `data/solutions/` | 建议同步进 git（data/solutions 若做成 git 仓库会自动 commit/push） |
| 面板 Token | `data/dashboard-token.txt` | 可重新生成 |

迁移：停服 → 拷贝整个 `data/` 目录 → 新机 `.env` 使用相同 `SECRET_KEY` → 启动。

## 7. 上线检查清单

- [ ] Node 22（preflight 通过）、Docker 可用
- [ ] `.env`：`BIND` / `ADMIN_TOKEN` / `SECRET_KEY` 按需设置
- [ ] `npm run web:build` 已执行（或 web/dist 已携带）
- [ ] `DRY_RUN=1` 全链路验证一次 → 关闭
- [ ] 面板配置 Cookie + LLM，Cookie 探针 `Authenticated`
- [ ] 手动 trigger-once 一题，确认 提交→判题→归档 全链路
- [ ] systemd/lc.sh 开机自启确认；日志滚动确认
- [ ] `data/` 目录纳入备份计划
