"""数据清理任务（手册 12.2：每周，清理过期临时文件）。

补充模块（4.1 的 tasks 清单里只有 scheduler / daily_question_job / reminder_job /
badge_job，本文件为「数据清理」这条任务清单项的实现，见 README「待确认」）。
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import List

from app.utils import file as file_utils
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

# 临时文件保留天数
RETENTION_DAYS = 7
RETENTION_SECONDS = RETENTION_DAYS * 24 * 3600

# 视为临时文件的目录/后缀
TEMP_DIR_NAMES = {"tmp", "temp", ".cache"}
TEMP_SUFFIXES = {".tmp", ".part", ".crdownload"}


def cleanup_expired_files() -> int:
    """删除 uploads 下的过期临时文件，返回删除数量。"""
    deleted = 0
    try:
        root = file_utils.get_upload_root()
        now = time.time()
        for path in _iter_candidates(root):
            try:
                if now - path.stat().st_mtime < RETENTION_SECONDS:
                    continue
                path.unlink()
                deleted += 1
                logger.info("已清理过期文件: %s", path)
            except OSError as exc:
                logger.warning("清理文件失败 path=%s err=%s", path, sanitize(exc))
        logger.info("数据清理完成，删除文件数=%s", deleted)
    except Exception as exc:  # noqa: BLE001
        logger.error("数据清理定时任务异常: %s", sanitize(exc))
    return deleted


def _iter_candidates(root: Path) -> List[Path]:
    """uploads 目录下所有属于「临时文件」的路径。"""
    candidates: List[Path] = []
    if not root.exists():
        return candidates
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        in_temp_dir = any(part in TEMP_DIR_NAMES for part in path.parts)
        if in_temp_dir or path.suffix.lower() in TEMP_SUFFIXES:
            candidates.append(path)
    return candidates
