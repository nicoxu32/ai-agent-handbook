#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if [[ ! -x .venv/bin/python ]]; then
  print '首次使用请先在本目录创建 Python 虚拟环境并安装 requirements.txt 中的依赖。'
  read '?按回车关闭'
  exit 1
fi
.venv/bin/python launch.py
