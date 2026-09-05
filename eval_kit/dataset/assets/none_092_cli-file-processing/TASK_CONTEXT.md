# Current task context

Scenario: CLI、批处理与文件安全
Stack: Python 3.12, argparse, pytest

User request:

只在 `src/batch.py` 中新增私有函数 `clamp_cli_file_processing(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
