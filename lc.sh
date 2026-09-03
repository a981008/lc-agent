#!/usr/bin/env bash
# lc-agent 启停脚本：./lc.sh {start|stop|restart|status|logs} [选项]
#   选项：
#     --dry-run     以模拟判题模式启动（无需凭据即可全链路演练）
#     --fg          前台运行（start 时直接占用终端，Ctrl+C 停止）
#   环境变量：PORT / BIND / DRY_RUN / ADMIN_TOKEN 等透传给服务（见 src/config.ts）
set -u

cd "$(dirname "$0")"

PORT="${PORT:-3081}"
RUN_DIR="logs"
PID_FILE="$RUN_DIR/lc-agent.pid"
LOG_FILE="$RUN_DIR/server.log"
READY_TIMEOUT=30          # start 就绪等待秒数
STOP_TIMEOUT=35           # stop 优雅等待秒数（IN_PROGRESS 收尾最长 120s，超时强杀）

mkdir -p "$RUN_DIR"

c_info() { printf '\033[36m%s\033[0m\n' "$*"; }
c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

running_pid() {
  # 输出：运行中的服务 PID；无则返回空
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$PID_FILE"   # 清理陈旧 pid 文件
  fi
  return 1
}

port_busy() {
  # 端口是否被占用（被本服务或外部进程）
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -q ":$PORT "
  else
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/" 2>/dev/null
  fi
}

wait_ready() {
  # 等待 HTTP 就绪（200 或 401 均视为已启动）
  local waited=0
  while [ "$waited" -lt "$READY_TIMEOUT" ]; do
    local code
    code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" 2>/dev/null || true)"
    if [ "$code" = "200" ] || [ "$code" = "401" ]; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

do_start() {
  local pid mode_fg dry
  mode_fg=0
  dry="${DRY_RUN:-}"
  for arg in "$@"; do
    case "$arg" in
      --fg) mode_fg=1 ;;
      --dry-run) dry=1 ;;
      *) c_err "未知选项：$arg"; exit 2 ;;
    esac
  done

  if pid="$(running_pid)"; then
    c_info "已在运行（PID $pid）→ http://127.0.0.1:$PORT"; exit 0
  fi
  if port_busy; then
    c_err "端口 $PORT 已被其他进程占用（无 pid 文件）。请排查：ss -tlnp | grep $PORT"; exit 1
  fi

  # 沙盒镜像预检（缺失时仅提示，SandboxRunner 启动后会自建）
  if command -v docker >/dev/null 2>&1 && ! docker image inspect lc-agent-sandbox:latest >/dev/null 2>&1; then
    c_info "提示：沙盒镜像 lc-agent-sandbox:latest 不存在，首次跑题会自动构建（需 Docker 网络）"
  fi

  local tsx="./node_modules/.bin/tsx"
  if [ ! -x "$tsx" ]; then
    c_err "未找到 $tsx，请先执行：npm install --cache ./.npm-cache"; exit 1
  fi

  # 原生模块 ABI 预检（better-sqlite3 与当前 Node 是否匹配）
  if ! node scripts/preflight.cjs; then
    exit 1
  fi

  # 前端（标准 Vue/Vite 工程）：产物缺失时自动安装依赖并构建
  if [ ! -f web/dist/index.html ]; then
    if [ ! -d web/node_modules ]; then
      c_info "安装前端依赖（web/）…"
      npm --prefix web install --cache ./.npm-cache --no-audit --no-fund >> "$LOG_FILE" 2>&1 \
        || { c_err "前端依赖安装失败，见 $LOG_FILE"; exit 1; }
    fi
    c_info "构建前端（web/dist）…"
    npm --prefix web run build >> "$LOG_FILE" 2>&1 \
      || { c_err "前端构建失败，见 $LOG_FILE"; exit 1; }
    c_ok "前端构建完成"
  fi

  c_info "启动 lc-agent（PORT=$PORT${dry:+, DRY_RUN=$dry}）…"
  if [ "$mode_fg" = "1" ]; then
    # 前台运行
    if [ -n "$dry" ]; then DRY_RUN=1 exec "$tsx" src/index.ts; else exec "$tsx" src/index.ts; fi
  fi

  if [ -n "$dry" ]; then
    nohup env DRY_RUN=1 "$tsx" src/index.ts >> "$LOG_FILE" 2>&1 &
  else
    nohup "$tsx" src/index.ts >> "$LOG_FILE" 2>&1 &
  fi
  local pid_new=$!
  echo "$pid_new" > "$PID_FILE"

  if wait_ready; then
    c_ok "✅ 已启动（PID $pid_new）→ http://127.0.0.1:$PORT"
    c_info "日志：tail -f $LOG_FILE"
    if [ -f data/dashboard-token.txt ]; then
      c_ok "Dashboard Token：$(cat data/dashboard-token.txt)"
    else
      c_info "Dashboard Token 见启动日志（data/dashboard-token.txt 尚未生成）"
    fi
  else
    c_err "❌ ${READY_TIMEOUT}s 内未就绪，最后日志："
    tail -n 20 "$LOG_FILE" >&2
    c_err "完整日志：$LOG_FILE"
    exit 1
  fi
}

# 停止服务；不再直接 exit（供 restart 串联调用）。返回 0=已停止或本来没在运行，1=端口被未知进程占用
do_stop() {
  local pid
  if ! pid="$(running_pid)"; then
    if port_busy; then
      c_err "端口 $PORT 有进程在监听，但无 pid 文件记录；如需强停请手动处理（ss -tlnp | grep $PORT）"
      return 1
    else
      c_info "未在运行"
    fi
    return 0
  fi

  c_info "停止 lc-agent（PID $pid，SIGTERM 优雅停机…）"
  kill -TERM "$pid" 2>/dev/null || true
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$STOP_TIMEOUT" ]; do
    sleep 1
    waited=$((waited + 1))
    # 每 10s 提示一次（IN_PROGRESS 收尾可能较久）
    if [ $((waited % 10)) -eq 0 ]; then c_info "  …仍在收尾（${waited}s，超时后将强制结束）"; fi
  done
  if kill -0 "$pid" 2>/dev/null; then
    c_err "优雅停机超时（${STOP_TIMEOUT}s），发送 SIGKILL 强制结束"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  c_ok "✅ 已停止"
  return 0
}

do_status() {
  local pid
  if pid="$(running_pid)"; then
    c_ok "运行中（PID $pid）→ http://127.0.0.1:$PORT"
    local code
    code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" 2>/dev/null || true)"
    c_info "HTTP /api/status → $code（200 正常 / 401 未带 Token）"
    if [ -f data/dashboard-token.txt ]; then
      c_info "Dashboard Token：$(cat data/dashboard-token.txt)"
    fi
    c_info "最近日志（tail -3）："
    tail -n 3 "$LOG_FILE" 2>/dev/null || true
  else
    c_info "未在运行"
    if port_busy; then c_err "注意：端口 $PORT 仍被占用（可能为残留进程）"; fi
  fi
}

case "${1:-}" in
  start)   shift; do_start "$@" ;;
  stop)    do_stop; exit $? ;;
  restart)
    shift
    if ! do_stop; then exit 1; fi
    # 等端口真正释放（最多 10s），避免 TIME_WAIT/句柄未关导致 EADDRINUSE
    local_wait=0
    while port_busy && [ "$local_wait" -lt 10 ]; do
      sleep 1
      local_wait=$((local_wait + 1))
    done
    do_start "$@"
    exit $?
    ;;
  status)  do_status ;;
  logs)    [ -f "$LOG_FILE" ] && tail -n 100 -f "$LOG_FILE" || c_info "暂无日志 $LOG_FILE" ;;
  *) echo "用法：./lc.sh {start|stop|restart|status|logs}"
     echo "  start [--dry-run] [--fg]   后台启动（--dry-run 模拟判题，--fg 前台运行）"
     echo "  stop                       优雅停机（SIGTERM，超时强杀）"
     echo "  restart [--dry-run]        重启"
     echo "  status                     运行状态 + Token + 最近日志"
     echo "  logs                       跟踪日志（tail -f）"
     exit 1 ;;
esac
