# 迁移脚本目录（Alembic version 文件）

本目录存放 Alembic 自动生成的迁移脚本，例如 `a1b2c3d4e5f6_init.py`。

初始状态下（骨架阶段）**本目录为空**——因为本机没有 Python，无法执行
`alembic revision --autogenerate`，所以没有提交任何迁移文件。

有 Python 3.12 后按下面步骤生成第一个迁移，详见 `backend/migrations/README.md`。
