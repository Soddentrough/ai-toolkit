#!/usr/bin/env bash
# AI Toolkit — System-Package Service Script
#
# Uses only installed system packages and pre-installed dependencies.
# Does not download or install anything automatically.
#
# Usage:
#   ./run_linux.sh [run|start [-d|--daemon]|stop|restart|status|check]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$SCRIPT_DIR/ui"
PID_FILE="$SCRIPT_DIR/.aitk_ui.pid"
LOG_FILE="$SCRIPT_DIR/.aitk_ui.log"
UI_PORT="${AI_TOOLKIT_PORT:-8675}"

# ── Colors & Output Helpers ──────────────────────────────────────────
if [[ -t 1 ]]; then
    C_CYAN='\033[36m'
    C_GREEN='\033[32m'
    C_YELLOW='\033[33m'
    C_RED='\033[31m'
    C_GRAY='\033[90m'
    C_RESET='\033[0m'
else
    C_CYAN='' C_GREEN='' C_YELLOW='' C_RED='' C_GRAY='' C_RESET=''
fi

info() { printf "${C_CYAN}[INFO]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}[ OK ]${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}[WARN]${C_RESET} %s\n" "$*"; }
err()  { printf "${C_RED}[FAIL]${C_RESET} %s\n" "$*" >&2; }

print_banner() {
    echo ""
    printf "%b" "$C_CYAN"
    cat << 'BANNER'
     _     ___   _____               _  _     _  _
    / \   |_ _| |_   _|  ___    ___ | || | __(_)| |_
   / _ \   | |    | |   / _ \  / _ \| || |/ /| || __|
  / ___ \  | |    | |  | (_) || (_) | ||   < | || |_
 /_/   \_\|___|   |_|   \___/  \___/|_||_|\_\|_| \__|
BANNER
    printf "%b" "$C_RESET"
    printf "${C_GRAY}  AI Toolkit — System Runner${C_RESET}\n\n"
}

# ── Dependency Checks (No Downloads / Installs) ──────────────────────
find_python() {
    for cmd in python3 python; do
        if command -v "$cmd" >/dev/null 2>&1; then
            echo "$cmd"
            return 0
        fi
    done
    return 1
}

check_dependencies() {
    local missing=0

    # 1. System binaries
    local py_cmd=""
    if py_cmd="$(find_python)"; then
        local py_ver
        py_ver="$("$py_cmd" --version 2>&1)"
        local py_maj py_min
        py_maj="$(echo "$py_ver" | sed -E 's/^Python ([0-9]+)\.([0-9]+).*/\1/')"
        py_min="$(echo "$py_ver" | sed -E 's/^Python ([0-9]+)\.([0-9]+).*/\2/')"
        if [[ "$py_maj" =~ ^[0-9]+$ ]] && (( py_maj < 3 || (py_maj == 3 && py_min < 10) )); then
            err "Python >= 3.10 is required (found: $py_ver at $(command -v "$py_cmd"))."
            missing=1
        else
            ok "Python: $py_ver ($(command -v "$py_cmd"))"
        fi
    else
        err "Missing system binary: python3 (install Python >= 3.10 via your system package manager)."
        missing=1
    fi

    if command -v node >/dev/null 2>&1; then
        local node_ver node_maj
        node_ver="$(node --version 2>&1)"
        node_maj="$(echo "$node_ver" | sed -E 's/^v([0-9]+).*/\1/')"
        if [[ "$node_maj" =~ ^[0-9]+$ ]] && (( node_maj < 20 )); then
            err "Node.js >= 20 is required (found: $node_ver at $(command -v node))."
            missing=1
        else
            ok "Node.js: $node_ver ($(command -v node))"
        fi
    else
        err "Missing system binary: node (install Node.js >= 20 via your system package manager)."
        missing=1
    fi

    if command -v npm >/dev/null 2>&1; then
        ok "npm: v$(npm --version 2>&1) ($(command -v npm))"
    else
        err "Missing system binary: npm (install npm via your system package manager)."
        missing=1
    fi

    if command -v ffmpeg >/dev/null 2>&1; then
        local ff_ver
        ff_ver="$(ffmpeg -version 2>&1 | head -n 1)"
        ok "FFmpeg: $ff_ver"
    else
        err "Missing system binary: ffmpeg (install ffmpeg via your system package manager)."
        missing=1
    fi

    # 2. Critical Python packages (checked via standard Python script on stdin, no inline -c)
    if [[ -n "$py_cmd" ]]; then
        local py_check_out
        if ! py_check_out="$("$py_cmd" - << 'PYEOF'
import importlib.util
import sys

REQUIRED = [
    ("torch", "torch"),
    ("torchvision", "torchvision"),
    ("torchaudio", "torchaudio"),
    ("diffusers", "diffusers"),
    ("transformers", "transformers"),
    ("accelerate", "accelerate"),
    ("safetensors", "safetensors"),
    ("peft", "peft"),
    ("yaml", "pyyaml"),
    ("PIL", "pillow"),
    ("cv2", "opencv-python"),
    ("numpy", "numpy"),
    ("scipy", "scipy"),
    ("einops", "einops"),
    ("huggingface_hub", "huggingface_hub"),
    ("dotenv", "python-dotenv"),
    ("tqdm", "tqdm"),
]

missing = []
for mod_name, pkg_name in REQUIRED:
    if importlib.util.find_spec(mod_name) is None:
        missing.append(pkg_name)

if missing:
    print("MISSING:" + ", ".join(missing))
    sys.exit(1)

import torch
backend = "CPU"
if getattr(torch.version, "hip", None):
    backend = f"ROCm {torch.version.hip}"
elif getattr(torch.version, "cuda", None):
    backend = f"CUDA {torch.version.cuda}"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    backend = "MPS"
print(f"OK:PyTorch {torch.__version__} ({backend})")
PYEOF
        )"; then
            local missing_pkgs="${py_check_out#MISSING:}"
            err "Missing critical Python packages: ${missing_pkgs}"
            err "Please install the required Python packages into your system environment before running."
            missing=1
        else
            ok "Python packages: ${py_check_out#OK:}"
        fi
    fi

    # 3. UI dependencies & build artifacts
    if [[ ! -d "$UI_DIR/node_modules" ]]; then
        err "Missing UI dependencies: $UI_DIR/node_modules not found."
        err "Please run 'cd ui && npm install --no-save' first."
        missing=1
    else
        ok "UI node_modules: present"
    fi

    if (( missing != 0 )); then
        echo ""
        err "Dependency check failed. Please install the missing dependencies listed above."
        return 1
    fi
    return 0
}

# ── Process Management (Run / Start / Stop / Status) ─────────────────
get_running_pid() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            echo "$pid"
            return 0
        fi
        rm -f "$PID_FILE"
    fi

    # Fallback: check for running fileServer or worker from this repo
    local pid
    pid="$(pgrep -f "$UI_DIR/node_modules/.bin/concurrently" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$pid" ]]; then
        echo "$pid"
        return 0
    fi
    pid="$(pgrep -f "dist/cron/fileServer.js" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$pid" ]]; then
        echo "$pid"
        return 0
    fi
    return 1
}

ensure_ui_built() {
    if [[ ! -f "$UI_DIR/dist/cron/worker.js" ]] || [[ ! -f "$UI_DIR/dist/cron/fileServer.js" ]] || [[ ! -d "$UI_DIR/.next" ]]; then
        info "UI build artifacts not found — building UI (update_db + build)..."
        (
            cd "$UI_DIR"
            npm run update_db
            npm run build
        )
    else
        # Always ensure database schema is up to date
        (
            cd "$UI_DIR"
            npm run update_db >/dev/null 2>&1 || npm run update_db
        )
    fi
}

cmd_status() {
    local pid=""
    if pid="$(get_running_pid)"; then
        ok "AI Toolkit UI is running (PID: $pid, URL: http://localhost:$UI_PORT)"
        if [[ -f "$LOG_FILE" ]]; then
            info "Log file: $LOG_FILE"
        fi
        return 0
    else
        info "AI Toolkit UI is stopped."
        return 1
    fi
}

cmd_stop() {
    local pid=""
    if ! pid="$(get_running_pid)"; then
        info "AI Toolkit UI is not running."
        return 0
    fi

    info "Stopping AI Toolkit UI (PID: $pid)..."
    # Send SIGTERM to the process group if possible, or the process and its children
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

    local waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < 20 )); do
        sleep 0.5
        waited=$(( waited + 1 ))
    done

    if kill -0 "$pid" 2>/dev/null; then
        warn "Process did not exit gracefully; sending SIGKILL..."
        kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi

    # Clean up any stray worker or fileServer children belonging to this checkout
    pkill -TERM -f "dist/cron/worker.js" 2>/dev/null || true
    pkill -TERM -f "dist/cron/fileServer.js" 2>/dev/null || true

    rm -f "$PID_FILE"
    ok "AI Toolkit UI stopped."
}

cmd_start() {
    local daemon=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -d|--daemon)
                daemon=1
                shift
                ;;
            *)
                err "Unknown option for start/run: $1"
                usage
                exit 1
                ;;
        esac
    done

    print_banner

    local existing_pid=""
    if existing_pid="$(get_running_pid)"; then
        warn "AI Toolkit UI is already running (PID: $existing_pid, URL: http://localhost:$UI_PORT)."
        exit 0
    fi

    check_dependencies
    ensure_ui_built

    cd "$UI_DIR"
    if (( daemon == 1 )); then
        info "Starting AI Toolkit UI in background on http://localhost:$UI_PORT ..."
        setsid npm run start >"$LOG_FILE" 2>&1 < /dev/null &
        local bg_pid=$!
        echo "$bg_pid" > "$PID_FILE"
        sleep 1
        if kill -0 "$bg_pid" 2>/dev/null; then
            ok "AI Toolkit UI started (PID: $bg_pid, Log: $LOG_FILE)"
        else
            rm -f "$PID_FILE"
            err "AI Toolkit UI failed to start. Check $LOG_FILE for details."
            exit 1
        fi
    else
        info "Starting AI Toolkit UI on http://localhost:$UI_PORT (Ctrl+C to stop)..."
        echo "$$" > "$PID_FILE"
        trap 'rm -f "$PID_FILE"' EXIT
        exec npm run start
    fi
}

usage() {
    cat << EOF
Usage: $(basename "$0") [COMMAND] [OPTIONS]

Commands:
  run, start [-d|--daemon]   Verify system dependencies and start the UI (default: foreground)
  stop                       Stop the running AI Toolkit UI instance
  restart [-d|--daemon]      Stop and restart the AI Toolkit UI instance
  status                     Show whether the AI Toolkit UI is running
  check                      Verify system binaries, Python packages, and UI dependencies
  help, -h, --help           Show this help message
EOF
}

# ── Entrypoint ───────────────────────────────────────────────────────
ACTION="${1:-run}"
shift || true

case "$ACTION" in
    run|start)
        cmd_start "$@"
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_stop
        cmd_start "$@"
        ;;
    status)
        cmd_status
        ;;
    check)
        print_banner
        check_dependencies
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        err "Unknown command: $ACTION"
        usage
        exit 1
        ;;
esac
