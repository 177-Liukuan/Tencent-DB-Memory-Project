# Current task context

Scenario: Docker / Linux 服务部署
Stack: Docker, Linux, Python 3.12, systemd

User request:

只在 `docker-compose.yml` 中新增私有函数 `clamp_docker_linux_ops(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
