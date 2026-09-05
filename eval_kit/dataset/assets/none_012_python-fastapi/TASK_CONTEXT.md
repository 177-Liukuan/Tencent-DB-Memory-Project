# Current task context

Scenario: Python / FastAPI 服务
Stack: Python 3.12, FastAPI, Pydantic v2, pytest, uv

User request:

只在 `app/services/user_service.py` 中新增私有函数 `clamp_python_fastapi(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
