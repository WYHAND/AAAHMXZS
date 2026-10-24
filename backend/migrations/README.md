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

骨架早期本机没有 Python，无法执行 `alembic revision --autogenerate`；后来虽然
有了 venv，但运行时一直走 `SQLModel.metadata.create_all` + `init_db` 的自愈路径，
所以**至今没有提交 baseline 迁移**。`app/models/` 下 17 张表的定义是完整的
（5.2 的 16 张 + 5.4 要求的 `test_questions`）。

> ⚠️ 现状：`alembic upgrade head` 在空库上**不会建任何表**。
> 生产 compose 默认走 `python -m app.db.init_db`，所以能跑；但如果你按本文档
> 直接执行 `alembic upgrade head`，会得到一张空库。先按下面「现有库接入 Alembic」
> 生成 baseline。

## 生成并执行迁移（需要在 backend/ 目录下，且已激活 venv）

```bash
cd backend

# 1. 准备 .env（至少要能连上 PostgreSQL）
#    DATABASE_URL=postgresql://ai_user:your_password@localhost:5432/ai_career

# 2. 生成初始迁移（读取 SQLModel.metadata，对比数据库现状）
alembic revision --autogenerate -m "init"

# 3. 检查生成的 migrations/versions/xxxx_init.py
#    - 确认 17 张表都在：users / profiles / profile_tags / test_questions /
#      test_results / conversations / messages / resumes / interviews /
#      interview_questions / tasks / task_steps / daily_questions /
#      daily_answers / reports / badges / user_badges
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

## 现有库接入 Alembic（重要，避免 "table already exists"）

已经用 `create_all` / `init_db` 建过表的库，**不要**直接 `alembic upgrade head`：
baseline 迁移会尝试再建一次表，直接报 `table already exists`。正确顺序：

```bash
cd backend

# 1) 先让现有库与模型对齐（补列 / 索引 / 唯一约束，幂等）
python -m app.db.init_db --no-seed

# 2) 在**空库**上生成 baseline（不要指向现有库，否则 autogenerate 什么都不生成）
$env:DATABASE_URL="sqlite:///./data/_baseline.db"   # PowerShell
alembic revision --autogenerate -m "baseline"
# 检查 migrations/versions/xxxx_baseline.py 后删除 data/_baseline.db

# 3) 现有库标记为 baseline（只写 alembic_version，不动数据/表）
alembic stamp head

# 4) 以后新增变更才走 upgrade
alembic revision --autogenerate -m "描述"
alembic upgrade head
```

新库/新环境则直接 `alembic upgrade head`。

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
