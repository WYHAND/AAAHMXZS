"""文件存储与解析（《开发手册》第 13 章）。

- 目录：``uploads/resumes/{user_id}/``（13.1）
- 文件名：``{uuid}.pdf`` / ``.docx``（13.1）
- 限制：PDF/Word，最大 10MB（13.2，来自 settings.MAX_UPLOAD_SIZE）
- 解析：pdfplumber / python-docx（13.3）
- 失败：提示切换引导式生成，保留已识别信息（13.4）
- 读取：**只能经带鉴权的端点**（14.5），见 ``resolve_download_path``

注：只接受 ``.docx``（python-docx 不支持老的二进制 ``.doc``），
手册 13.2 说的"PDF/Word"按 ``.pdf`` + ``.docx`` 落地，见 README「待确认」。
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Dict, Optional, Tuple

from app.core.config import settings
from app.core.errors import BusinessException
from app.utils.logger import get_logger

logger = get_logger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx"}
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# 扩展名 -> 下载时的 media_type（13.2 只允许这两种）
CONTENT_TYPES_BY_EXT: Dict[str, str] = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
DEFAULT_CONTENT_TYPE = "application/octet-stream"

# 下载文件名里不允许出现的字符：路径分隔符 + Windows 保留字符 + 控制字符（含 \r\n）
_UNSAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')


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
    """校验扩展名/大小（13.2），返回规范化后的扩展名。

    - 只允许 ``.pdf`` / ``.docx``；旧版二进制 ``.doc`` **明确拒绝**并给中文提示
      （python-docx 读不了 ``.doc``，放进来也只会在解析阶段失败）；
    - 超限/类型不符都抛 ``param_error`` -> code 1001（HTTP 400），不是 500。
    """
    ext = Path(safe_filename(filename)).suffix.lower()

    if ext == ".doc":
        # 单独提示，避免用户以为"Word 不支持"而放弃
        raise BusinessException.param_error("不支持旧版 .doc，请在 Word 里另存为 .docx 后重新上传")
    if ext not in ALLOWED_EXTENSIONS:
        raise BusinessException.param_error("仅支持 PDF / .docx 文件")

    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        # content_type 由客户端控制，只记日志不拒绝；真正的判据是扩展名 + 后续解析
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
    """把 ``file_path`` 还原成磁盘绝对路径（**不做安全校验**，内部用途）。

    支持两种存法（骨架里统一用 ``resumes/{user_id}/{uuid}.pdf``）：
    - ``resumes/{user_id}/xxx.pdf``  -> ``{UPLOAD_DIR}/resumes/{user_id}/xxx.pdf``
    - ``uploads/resumes/...``        -> 按 backend 根解析

    ⚠️ 对外提供文件下载时**必须**用 :func:`resolve_download_path`，
    它额外做了「规范化后仍在 UPLOAD_DIR 之内」的校验（防目录穿越，14.7 的思路）。
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


def is_within_upload_dir(path: Path) -> bool:
    """``path`` 规范化之后是否仍位于 ``UPLOAD_DIR`` 之内（含其自身）。

    实现要点：
    - ``Path.resolve()`` 会把 ``..``、``.`` 以及符号链接解析掉，
      所以 ``uploads/../../etc/passwd`` 这类会被展开成真实路径再比较；
    - 用 ``root in path.parents`` 判断「父目录链里有没有 root」，
      而不是用字符串 ``startswith``（后者会把 ``/data/uploads-evil`` 误判为在
      ``/data/uploads`` 之内）。
    """
    try:
        root = get_upload_root().resolve()
        candidate = path.resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        # OSError: 路径过长/非法字符；RuntimeError: 符号链接成环（旧版本 Python）；ValueError: 空路径
        logger.warning("路径规范化失败: %s (%s)", path, exc)
        return False
    return candidate == root or root in candidate.parents


def resolve_download_path(stored_path: str) -> Path:
    """把数据库里的 ``file_path`` 解析成可下载的绝对路径，并**强制**校验不越界。

    越界（目录穿越、绝对路径逃逸、符号链接出圈）一律按「文件不存在」拒绝（2001），
    记 error 日志但不把真实原因暴露给调用方。
    """
    if not stored_path or not str(stored_path).strip():
        raise BusinessException.not_found("简历文件不存在")

    candidate = resolve_stored_path(str(stored_path))
    if not is_within_upload_dir(candidate):
        logger.error("拒绝越界的文件路径（疑似目录穿越）: %s", stored_path)
        raise BusinessException.not_found("简历文件不存在")
    return candidate.resolve()


def content_type_for(path: str | Path) -> str:
    """按扩展名给下载用的 ``media_type``（13.2 只有 .pdf / .docx）。"""
    ext = Path(path).suffix.lower()
    return CONTENT_TYPES_BY_EXT.get(ext, DEFAULT_CONTENT_TYPE)


def build_download_filename(title: Optional[str], ext: str) -> str:
    """构造 ``Content-Disposition`` 里的文件名。

    - 去掉路径分隔符、Windows 保留字符与控制字符（含 ``\\r\\n``，防响应头注入）；
    - 中文与空格保留（Starlette 会做 RFC 5987 的 ``filename*=utf-8''`` 编码）；
    - 空标题/纯符号时回退成 ``resume``；
    - 确保带上正确扩展名（前端靠它选择打开方式）。
    """
    raw = str(title or "").strip()
    cleaned = _UNSAFE_FILENAME_RE.sub("_", raw)
    cleaned = cleaned.strip(" .") or "resume"
    cleaned = cleaned[:80]
    suffix = (ext or "").lower()
    if suffix and not cleaned.lower().endswith(suffix):
        cleaned = f"{cleaned}{suffix}"
    return cleaned


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
        elif ext == ".docx":
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
