"""Cloudflare R2 (S3-compatible) storage wrapper.

R2 dùng cho production split-deploy: VPS API + RunPod worker không còn SCP
file qua SSH; cả 2 đều upload/download trực tiếp tới R2 bucket. FE/desktop
cũng có thể upload thẳng qua presigned URL, không qua VPS.

Bucket layout:
- voxstudio-public/audio/<file_id>.wav        ← TTS output, public read
- voxstudio-private/uploads/<key>             ← raw upload từ user (STT/clone)
- voxstudio-private/voices/<owner>/<vid>.{pt,json,wav}
- voxstudio-private/dubbing/<project_id>/...

Module exports low-level ops; service layer (storage.py / handlers.py) dispatch
giữa local FS và R2 dựa vào STORAGE_BACKEND env.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import IO, Optional

from app.config import (
    R2_ACCESS_KEY_ID,
    R2_BUCKET_PRIVATE,
    R2_BUCKET_PUBLIC,
    R2_ENDPOINT_URL,
    R2_PUBLIC_URL,
    R2_SECRET_ACCESS_KEY,
)

logger = logging.getLogger(__name__)

# Lazy init — boto3 import nặng (~200ms), không load nếu STORAGE_BACKEND=local
_client = None
_client_lock = threading.Lock()


def _get_client():
    """Singleton boto3 S3 client trỏ tới R2 endpoint. Thread-safe."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        if not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY or not R2_ENDPOINT_URL:
            raise RuntimeError(
                "R2 credentials chưa cấu hình. Cần set R2_ACCOUNT_ID + "
                "R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY trong .env."
            )
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",  # R2 yêu cầu "auto"
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
                # Connect timeout ngắn để fail fast khi mạng đứt; read timeout
                # dài cho upload file lớn (audio/video dubbing).
                connect_timeout=10,
                read_timeout=300,
            ),
        )
        return _client


# ── Bucket helpers ────────────────────────────────────

def public_bucket() -> str:
    return R2_BUCKET_PUBLIC


def private_bucket() -> str:
    return R2_BUCKET_PRIVATE


def public_url(key: str) -> str:
    """Build URL tải file từ public bucket. Yêu cầu R2_PUBLIC_URL đã set
    (pub-xxx.r2.dev hoặc files.voxstudio.vn)."""
    if not R2_PUBLIC_URL:
        raise RuntimeError(
            "R2_PUBLIC_URL chưa cấu hình — cần URL của public bucket "
            "(pub-xxx.r2.dev hoặc files.voxstudio.vn)."
        )
    return f"{R2_PUBLIC_URL}/{key.lstrip('/')}"


# ── Upload ────────────────────────────────────────────

def upload_file(
    local_path: str | Path,
    key: str,
    *,
    bucket: Optional[str] = None,
    content_type: Optional[str] = None,
) -> str:
    """Upload file local lên R2. Trả về key. Raise nếu fail (không silent).

    Mặc định upload vào private bucket — caller phải truyền bucket nếu muốn
    public (vd audio output).
    """
    bucket = bucket or R2_BUCKET_PRIVATE
    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    client = _get_client()
    with open(local_path, "rb") as f:
        client.upload_fileobj(f, bucket, key, ExtraArgs=extra or None)
    logger.debug("[r2] uploaded %s → %s/%s", local_path, bucket, key)
    return key


def upload_fileobj(
    fileobj: IO[bytes],
    key: str,
    *,
    bucket: Optional[str] = None,
    content_type: Optional[str] = None,
) -> str:
    """Upload từ file-like object (vd UploadFile của FastAPI) — không cần
    save xuống disk trước."""
    bucket = bucket or R2_BUCKET_PRIVATE
    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    _get_client().upload_fileobj(fileobj, bucket, key, ExtraArgs=extra or None)
    logger.debug("[r2] uploaded fileobj → %s/%s", bucket, key)
    return key


def upload_bytes(
    data: bytes,
    key: str,
    *,
    bucket: Optional[str] = None,
    content_type: Optional[str] = None,
) -> str:
    """Upload bytes (vd JSON metadata, embedding tensor đã serialize)."""
    bucket = bucket or R2_BUCKET_PRIVATE
    kwargs: dict = {"Bucket": bucket, "Key": key, "Body": data}
    if content_type:
        kwargs["ContentType"] = content_type
    _get_client().put_object(**kwargs)
    return key


# ── Download ──────────────────────────────────────────

def download_file(
    key: str,
    local_path: str | Path,
    *,
    bucket: Optional[str] = None,
) -> Path:
    """Download file từ R2 về local_path. Tự tạo thư mục cha nếu chưa có."""
    bucket = bucket or R2_BUCKET_PRIVATE
    p = Path(local_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    _get_client().download_file(bucket, key, str(p))
    logger.debug("[r2] downloaded %s/%s → %s", bucket, key, p)
    return p


def download_bytes(key: str, *, bucket: Optional[str] = None) -> bytes:
    """Download object thành bytes (cho file nhỏ như JSON metadata)."""
    bucket = bucket or R2_BUCKET_PRIVATE
    obj = _get_client().get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


# ── Presigned URL ─────────────────────────────────────

def presigned_put_url(
    key: str,
    *,
    bucket: Optional[str] = None,
    expires: int = 3600,
    content_type: Optional[str] = None,
) -> str:
    """Tạo presigned PUT URL — FE/desktop dùng để upload TRỰC TIẾP lên R2,
    không qua VPS. expires tính bằng giây (default 1h).

    content_type bắt buộc nếu client gửi Content-Type header khi PUT — nếu
    không khớp signature sẽ fail.
    """
    bucket = bucket or R2_BUCKET_PRIVATE
    params: dict = {"Bucket": bucket, "Key": key}
    if content_type:
        params["ContentType"] = content_type
    return _get_client().generate_presigned_url(
        "put_object", Params=params, ExpiresIn=expires,
    )


def presigned_get_url(
    key: str,
    *,
    bucket: Optional[str] = None,
    expires: int = 86400,
) -> str:
    """Tạo presigned GET URL cho file private (vd uploads/, voices/).
    Cho file public, dùng public_url() thay vì presign."""
    bucket = bucket or R2_BUCKET_PRIVATE
    return _get_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


# ── Delete / list ─────────────────────────────────────

def delete(key: str, *, bucket: Optional[str] = None) -> bool:
    """Xoá object. Idempotent — không raise nếu key không tồn tại."""
    bucket = bucket or R2_BUCKET_PRIVATE
    try:
        _get_client().delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        logger.warning("[r2] delete failed %s/%s: %s", bucket, key, e)
        return False


def delete_many(keys: list[str], *, bucket: Optional[str] = None) -> int:
    """Batch delete (max 1000/call). Trả về số key đã xoá."""
    if not keys:
        return 0
    bucket = bucket or R2_BUCKET_PRIVATE
    deleted = 0
    # S3 API max 1000 objects/call
    for i in range(0, len(keys), 1000):
        batch = keys[i : i + 1000]
        try:
            res = _get_client().delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
            )
            deleted += len(batch) - len(res.get("Errors", []) or [])
        except Exception as e:
            logger.warning("[r2] batch delete failed: %s", e)
    return deleted


def list_prefix(prefix: str, *, bucket: Optional[str] = None) -> list[str]:
    """List tất cả key có prefix. Tự paginate. Cho prefix lớn cẩn thận quota."""
    bucket = bucket or R2_BUCKET_PRIVATE
    keys: list[str] = []
    client = _get_client()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            keys.append(obj["Key"])
    return keys


def exists(key: str, *, bucket: Optional[str] = None) -> bool:
    """Check object tồn tại không (HEAD request, rẻ)."""
    bucket = bucket or R2_BUCKET_PRIVATE
    try:
        _get_client().head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False
