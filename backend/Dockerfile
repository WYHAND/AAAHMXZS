# 后端镜像（手册 16.2：app 服务由 ./backend 构建）
#
# 构建：docker build -t ai-career-backend ./backend
# 运行：见仓库根目录 docker-compose.yml（推荐用 docker-compose up -d，手册 16.4）

FROM python:3.12-slim

# 中文日志友好 + 不写 .pyc + 不缓冲 stdout（便于 docker logs 实时看到日志）
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LANG=C.UTF-8 \
    TZ=Asia/Shanghai

WORKDIR /app

# psycopg2-binary 自带 libpq，但仍需要 curl 做健康检查
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖，利用 Docker 层缓存
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/requirements.txt

# 再拷代码（含 alembic.ini 与 migrations/，容器内可执行迁移）
COPY . /app

# 简历文件目录（13.1；compose 里会挂卷覆盖）
RUN mkdir -p /app/uploads/resumes

EXPOSE 8000

# 16.2 / 3.6：uvicorn 启动
# 生产建议去掉 --reload，并设置 workers（单机 2核4G，手册 16.1）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
