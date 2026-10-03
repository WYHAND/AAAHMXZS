"""文件存储工具（《开发手册》第 13 章）。

老 ATS 链路的文件能力 —— ``uploads/resumes/{user_id}/`` 落盘、上传校验
（扩展名/大小）、PDF/Word 文本抽取、带鉴权的下载与目录穿越校验 —— 已随该链路
整体移除（2026-11，见 README §4.10）。

现在本模块只剩「uploads 根目录」与「数据清理」需要的通用工具：

- :func:`get_upload_root`：``UPLOAD_DIR`` 的绝对路径（不存在则创建），
  定时任务 ``app/tasks/cleanup_job.py`` 用它遍历临时文件；
- :func:`resolve_stored_path` / :func:`delete_file`：把相对路径还原成磁盘路径、
  删除文件（数据清理用途；老链路删除后**当前无调用点**，保留给清理类脚本/任务）。

⚠️ 老链路里对外提供文件下载时必须走带目录穿越校验的 ``resolve_download_path``，
那个函数已随老链路一起删除；若要重新对外提供文件，先把它（含
「规范化后必须仍在 ``UPLOAD_DIR`` 之内」的校验）重新实现，不要直接用
:func:`resolve_stored_path` 拼路径输出。
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


def get_upload_root() -> Path:
    """上传根目录（绝对路径），不存在则创建。"""
    root = Path(settings.UPLOAD_DIR).expanduser()
    if not root.is_absolute():
        # 相对路径以 backend/ 为基准（uvicorn 在 backend/ 下启动）
        root = (Path.cwd() / root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_stored_path(relative: str) -> Path:
    """把 ``file_path`` 还原成磁盘绝对路径（**不做安全校验**，内部用途）。

    支持两种存法：
    - ``resumes/{user_id}/xxx.pdf``  -> ``{UPLOAD_DIR}/resumes/{user_id}/xxx.pdf``
    - ``uploads/resumes/...``        -> 按 backend 根解析
    """
    candidate = Path(relative)
    if candidate.is_absolute():
        return candidate

    root = get_upload_root()
    parts = candidate.parts
    if parts and parts[0] == "resumes":
        return root / candidate
    if parts and parts[0] == "uploads":
        return root.parent / candidate
    return root / candidate


def delete_file(relative: str) -> bool:
    """删除文件（数据清理定时任务用）。"""
    try:
        path = resolve_stored_path(relative)
        if path.exists():
            path.unlink()
            return True
    except OSError as exc:
        logger.warning("删除文件失败 path=%s err=%s", relative, exc)
    return False
