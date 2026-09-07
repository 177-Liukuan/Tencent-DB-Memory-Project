#!/usr/bin/env bash
set -euo pipefail

eval_kit_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
default_config="$eval_kit_dir/configs/data-preparation.yaml"
config_file=${EVAL_KIT_DATA_CONFIG:-${DATA_BUILDER_CONFIG:-$default_config}}

exec npm --prefix "$eval_kit_dir" run data:prepare -- --config "$config_file" "$@"
