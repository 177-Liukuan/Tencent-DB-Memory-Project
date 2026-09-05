# Current task context

Scenario: CI/CD 与版本发布
Stack: GitHub Actions, Node.js, Docker, Kubernetes

User request:

只在 `scripts/release.sh` 中新增私有函数 `clamp_cicd_release(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
