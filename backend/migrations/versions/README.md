# 迁移脚本目录（Alembic version 文件）

本目录存放 Alembic 自动生成的迁移脚本，例如 `a1b2c3d4e5f6_init.py`。

初始状态下本目录为空：运行时走 `SQLModel.metadata.create_all` + `init_db`，
尚未提交 baseline 迁移。生成 baseline 与"现有库 stamp"的完整步骤见
`backend/migrations/README.md` 的「现有库接入 Alembic」。
