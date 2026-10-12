#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
FRONTEND_DIR="$ROOT_DIR/frontend"

export VITE_DATA_MODE=api
export VITE_API_BASE_URL=/api/v1
if [[ -n "${MSYS2_ENV_CONV_EXCL:-}" ]]; then
  case ";$MSYS2_ENV_CONV_EXCL;" in
    *";VITE_API_BASE_URL;"*) ;;
    *) export MSYS2_ENV_CONV_EXCL="$MSYS2_ENV_CONV_EXCL;VITE_API_BASE_URL" ;;
  esac
else
  export MSYS2_ENV_CONV_EXCL=VITE_API_BASE_URL
fi

cd "$FRONTEND_DIR"
printf 'Building frontend in API mode ...\n'
npm run build
printf 'Starting Vite on 127.0.0.1:5173 (Ctrl+C to stop).\n'
exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
