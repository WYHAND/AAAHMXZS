# 数据库迁移说明（Alembic）

对应《开发手册》5.5 数据库迁移、17.6 数据库变更。

## 目录约定

```text
backend/
├── alembic.ini          # Alembic 配置（script_location = migrations）
└── migrations/
    ├── env.py           # 运行环境（连接串取自 app.core.config.settings）
    ├── script.py.mako   # 迁移脚本模板
    └── versions/        # 迁移脚本目录（骨架阶段为空，见下）
```

> 手册 5.5 的示例命令是 `alembic init migrations`，所以脚本目录用 `migrations/`
> 而不是 Alembic 默认的 `alembic/`，两者含义相同。

## 为什么 `versions/` 现在是空的

本机**没有 Python**（`python -V` 返回 9009，`py` 不存在），无法执行
`alembic revision --autogenerate`，因此没有提交任何迁移脚本。
`app/models/` 下 16 张表的定义是完整的，第一个迁移文件请在装有 Python 3.12 的
机器上按下节命令生成。

## 生成并执行迁移（需要在 backend/ 目录下，且已激活 venv）

```bash
cd backend

# 1. 准备 .env（至少要能连上 PostgreSQL）
#    DATABASE_URL=postgresql://ai_user:your_password@localhost:5432/ai_career

# 2. 生成初始迁移（读取 SQLModel.metadata，对比数据库现状）
alembic revision --autogenerate -m "init"

# 3. 检查生成的 migrations/versions/xxxx_init.py
#    - 确认 16 张表都在：users / profiles / profile_tags / test_results /
#      conversations / messages / resumes / interviews / interview_questions /
#      tasks / task_steps / daily_questions / daily_answers / reports /
#      badges / user_badges
#    - JSONB 字段应生成 postgresql.JSONB；UUID 主键应生成 sa.Uuid()
#    - 如自动生成漏了外键或唯一索引，手工补齐

# 4. 执行迁移
alembic upgrade head

# 常用辅助命令
alembic current                     # 当前版本
alembic history --verbose           # 迁移历史
alembic downgrade -1                # 回退一步
alembic revision --autogenerate -m "add xxx"   # 后续变更
```

## 在 Docker 里执行

`docker-compose.yml` 提供了两种方式（容器内工作目录是 `/app`，即 `backend/`）：

```bash
# 方式一：启动时自动迁移（app 服务的 command 里已包含）
docker-compose up -d

# 方式二：单独跑一次迁移服务（只迁移不起服务）
docker-compose run --rm migrate
```

注意容器里 `DATABASE_URL` 的主机名是 `db`（服务名），不是 `localhost`。

## 常见问题

| 现象 | 排查 |
|---|---|
| `Target database is not up to date` | 先 `alembic current` 看版本，再决定 `upgrade head` 或 `stamp head` |
| autogenerate 生成空迁移 | `migrations/env.py` 里 `import app.models` 是否生效；`target_metadata` 是否为 `SQLModel.metadata` |
| 类型不匹配（把 JSON 改成 JSONB） | Alembic 对 JSON/JSONB 的 compare_type 不敏感，需人工在迁移里写 `postgresql.JSONB` |
| 连接被拒绝 | `.env` 的 `DATABASE_URL`、PostgreSQL 是否已启动（手册 3.10） |
| 中文乱码 | 迁移脚本用 UTF-8 保存；Windows 下不要用 ANSI 写 .py 文件 |

## 变更流程（17.6）

1. 改 `app/models/` 里的 SQLModel 定义；
2. `alembic revision --autogenerate -m "描述"`；
3. 人工 review 生成的脚本（尤其是 JSONB、外键、索引、可空性）；
4. 提交脚本 + 模型改动到同一个 commit；
5. 部署时 `alembic upgrade head`。
