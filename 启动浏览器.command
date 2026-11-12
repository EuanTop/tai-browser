#!/bin/zsh
set -eu
PROJECT_DIR=${0:A:h}
if [[ ! -f "$PROJECT_DIR/tools/run_product.py" ]]; then
  print -u2 "找不到浏览器项目，请先挂载 TAi 工作区。"
  exit 1
fi
exec /usr/bin/env python3 "$PROJECT_DIR/tools/run_product.py"
