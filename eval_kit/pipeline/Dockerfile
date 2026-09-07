FROM buildpack-deps:noble-curl
# 环境构建发生在计时之前；两组使用同一镜像，只有当前任务素材可见。
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources && apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip git build-essential ripgrep
COPY node /opt/node
COPY uv /usr/local/bin/uv
ENV PATH="/opt/node/bin:${PATH}"
RUN npm install --global pnpm@10.11.0
ARG EVAL_UID=1000
ARG EVAL_GID=1000
# 与素材目录的属主一致，包管理器也能找到真实 home，而不是退到只读根目录。
RUN usermod --uid "$EVAL_UID" ubuntu && groupmod --gid "$EVAL_GID" ubuntu && usermod --gid "$EVAL_GID" ubuntu && chown -R "$EVAL_UID:$EVAL_GID" /home/ubuntu
# 非 root CLI 的包管理器需要可写缓存；匿名卷随 docker run --rm 删除。
VOLUME /home/ubuntu
