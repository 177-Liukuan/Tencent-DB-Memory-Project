#!/usr/bin/env bash
set -euo pipefail
# 从任意目录调用；配置内路径由 YAML 所在目录解析。
eval_kit_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -ne 1 ]]; then
  echo "用法: bash $eval_kit_dir/run-pipeline.sh /absolute/path/pilot.yaml" >&2
  exit 2
fi
eval_config="$(realpath -- "$1")"
cd -- "$eval_kit_dir"
exec npm run pipeline -- --config "$eval_config"
