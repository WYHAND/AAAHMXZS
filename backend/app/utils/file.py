"""文件存储与解析（《开发手册》第 13 章）。

- 目录：``uploads/resumes/{user_id}/``（13.1）
- 文件名：``{uuid}.pdf`` / ``.docx``（13.1）
- 限制：PDF/Word，最大 10MB（13.2，来自 settings.MAX_UPLOAD_SIZE）
- 解析：pdfplumber / python-docx（13.3）
- 失败：提示切换引导式生成，保留已识别信息（13.4）
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Optional, Tuple

from app.core.config import settings
from app.core.errors import BusinessException
from app.utils.logger import get_logger

logger = get_logger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def get_upload_root() -> Path:
    """上传根目录（绝对路径），不存在则创建。"""
    root = Path(settings.UPLOAD_DIR).expanduser()
    if not root.is_absolute():
        # 相对路径以 backend/ 为基准（uvicorn 在 backend/ 下启动）
        root = (Path.cwd() / root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_resume_dir(user_id: str | uuid.UUID) -> Path:
    """13.1：每个用户一个子目录。"""
    path = get_upload_root() / "resumes" / str(user_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_filename(filename: str) -> str:
    """清洗原始文件名，防止路径穿越。"""
    name = os.path.basename(filename or "")
    return re.sub(r"[^A-Za-z0-9._\u4e00-\u9fff-]", "_", name)[:120]


def validate_upload(filename: str, size: int, content_type: Optional[str] = None) -> str:
    """校验扩展名/大小（13.2），返回规范化后的扩展名。"""
    ext = Path(safe_filename(filename)).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise BusinessException.param_error("仅支持 PDF / Word 文件")
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        logger.warning("上传 content_type 非预期: %s（仍按扩展名 %s 处理）", content_type, ext)
    if size > settings.MAX_UPLOAD_SIZE:
        raise BusinessException.param_error(
            f"文件超过大小限制 {settings.MAX_UPLOAD_SIZE // (1024 * 1024)}MB"
        )
    return ext


def build_resume_path(user_id: str | uuid.UUID, ext: str) -> Tuple[Path, str]:
    """生成 ``uploads/resumes/{user_id}/{uuid}{ext}``，返回 (绝对路径, 相对路径)。

    相对路径写进 ``resumes.file_path``（13.1：数据库存路径）。
    """
    target_dir = get_resume_dir(user_id)
    name = f"{uuid.uuid4().hex}{ext}"
    absolute = target_dir / name
    relative = str(Path("resumes") / str(user_id) / name)
    return absolute, relative


def save_bytes(path: Path, content: bytes) -> int:
    """写入磁盘，返回字节数。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fp:
        fp.write(content)
    return len(content)


def resolve_stored_path(relative: str) -> Path:
    """把 ``file_path`` 还原成磁盘绝对路径。

    支持两种存法（骨架里统一用 ``resumes/{user_id}/{uuid}.pdf``）：
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


# ---------------- 13.3 解析 ----------------

def parse_pdf(path: str | Path) -> str:
    """提取 PDF 文本（13.3）。"""
    import pdfplumber  # 局部导入：未安装时不至于影响应用启动

    with pdfplumber.open(str(path)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


def parse_docx(path: str | Path) -> str:
    """提取 Word 文本（13.3）。"""
    from docx import Document  # python-docx

    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs)


def extract_text_from_file(path: str | Path) -> str:
    """按扩展名选择解析器；解析失败抛业务异常（13.4 提示切换引导式生成）。"""
    file_path = Path(path)
    ext = file_path.suffix.lower()
    try:
        if ext == ".pdf":
            text = parse_pdf(file_path)
        elif ext in {".docx", ".doc"}:
            text = parse_docx(file_path)
        else:
            raise BusinessException.param_error("不支持的文件类型")
    except BusinessException:
        raise
    except Exception as exc:  # noqa: BLE001 - 解析库抛出各种异常
        logger.warning("简历解析失败 path=%s err=%s", file_path, exc)
        raise BusinessException.param_error("文件解析失败，请改用引导式生成简历") from exc

    if not text.strip():
        raise BusinessException.param_error("未解析到文本内容，建议改用引导式生成简历")
    return text


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
