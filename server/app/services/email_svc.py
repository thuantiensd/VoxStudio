"""SMTP email service.

Cấu hình qua env vars:
    SMTP_HOST       (vd smtp.gmail.com)
    SMTP_PORT       (587 cho STARTTLS, 465 cho SSL)
    SMTP_USER       (email gửi)
    SMTP_PASS       (App password 16 chars cho Gmail)
    SMTP_FROM_NAME  (vd "VoxStudio")
    APP_BASE_URL    (link verify trong email, vd https://voxstudio.app)

Nếu thiếu config → log warning + skip gửi (dev mode). User vẫn đăng ký
được nhưng không nhận email — admin có thể verify thủ công qua DB.
"""

import asyncio
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

logger = logging.getLogger(__name__)


def _config() -> dict | None:
    """Load SMTP config từ env. Trả None nếu thiếu host/user."""
    host = os.environ.get("SMTP_HOST", "").strip()
    user = os.environ.get("SMTP_USER", "").strip()
    if not host or not user:
        return None
    return {
        "host": host,
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": user,
        "password": os.environ.get("SMTP_PASS", "").strip(),
        "from_name": os.environ.get("SMTP_FROM_NAME", "VoxStudio").strip(),
        "app_url": os.environ.get("APP_BASE_URL", "https://voxstudio.app").rstrip("/"),
    }


def _send_sync(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Blocking SMTP send. Trả True nếu OK, False nếu lỗi."""
    cfg = _config()
    if cfg is None:
        logger.warning("SMTP not configured — skip email to %s", to_email)
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((cfg["from_name"], cfg["user"]))
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    try:
        if cfg["port"] == 465:
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15) as s:
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as s:
                s.starttls()
                s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        logger.info("Email sent → %s (subject=%r)", to_email, subject)
        return True
    except Exception as e:
        logger.warning("SMTP send failed for %s: %s", to_email, e)
        return False


async def send_email(to_email: str, subject: str,
                     html_body: str, text_body: str) -> bool:
    """Gửi email không block event loop — chạy trong threadpool."""
    return await asyncio.to_thread(_send_sync, to_email, subject, html_body, text_body)


# ── Templates ────────────────────────────────────────

def _otp_html_block(code: str) -> str:
    """Block hiển thị OTP cỡ lớn — dùng chung cho verify + reset."""
    return f"""
  <div style="text-align: center; margin: 28px 0;">
    <div style="display: inline-block; padding: 18px 28px;
                background: linear-gradient(135deg, rgba(108,92,242,0.08), rgba(236,72,153,0.06));
                border: 2px solid #6c5cf2; border-radius: 12px;">
      <div style="font-family: 'SF Mono', Menlo, monospace; font-size: 32px;
                  font-weight: 700; color: #6c5cf2; letter-spacing: 8px;">
        {code}
      </div>
    </div>
  </div>
"""


def verification_email(name: str, code: str) -> tuple[str, str, str]:
    """Trả (subject, html, text) cho email OTP xác thực — 6 chữ số."""
    subject = f"Mã xác thực VoxStudio: {code}"
    text = f"""Chào {name},

Mã xác thực email VoxStudio của bạn:

    {code}

Mã có hiệu lực trong 10 phút. Nhập mã này vào ứng dụng VoxStudio để hoàn
tất đăng ký.

Nếu bạn không đăng ký tài khoản này, vui lòng bỏ qua email này.

— VoxStudio
"""
    html = f"""\
<!DOCTYPE html>
<html><body style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
  <h2 style="margin: 0 0 16px; color: #6c5cf2;">Xác thực email</h2>
  <p>Chào <b>{name}</b>,</p>
  <p>Cảm ơn bạn đã đăng ký VoxStudio. Nhập mã sau vào ứng dụng để hoàn tất:</p>
  {_otp_html_block(code)}
  <p style="font-size: 12px; color: #6b7280; text-align: center;">
    Mã có hiệu lực trong <b>10 phút</b>.
  </p>
  <p style="font-size: 12px; color: #6b7280;">
    Nếu bạn không đăng ký tài khoản này, vui lòng bỏ qua email.
  </p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <p style="font-size: 11px; color: #9ca3af;">— VoxStudio Team</p>
</body></html>
"""
    return subject, html, text


def password_reset_email(name: str, code: str) -> tuple[str, str, str]:
    """Trả (subject, html, text) cho email OTP reset mật khẩu."""
    subject = f"Mã đặt lại mật khẩu VoxStudio: {code}"
    text = f"""Chào {name},

Mã đặt lại mật khẩu của bạn:

    {code}

Mã có hiệu lực trong 10 phút. Nhập mã này vào ứng dụng VoxStudio để đặt
mật khẩu mới.

Nếu không phải bạn yêu cầu, vui lòng bỏ qua email — mật khẩu hiện tại
vẫn còn hiệu lực.

— VoxStudio
"""
    html = f"""\
<!DOCTYPE html>
<html><body style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
  <h2 style="margin: 0 0 16px; color: #6c5cf2;">Đặt lại mật khẩu</h2>
  <p>Chào <b>{name}</b>,</p>
  <p>Bạn vừa yêu cầu đặt lại mật khẩu VoxStudio. Nhập mã sau vào ứng dụng:</p>
  {_otp_html_block(code)}
  <p style="font-size: 12px; color: #6b7280; text-align: center;">
    Mã có hiệu lực trong <b>10 phút</b>.
  </p>
  <p style="font-size: 12px; color: #6b7280;">
    Nếu không phải bạn yêu cầu, vui lòng bỏ qua email — mật khẩu hiện tại
    của bạn vẫn còn hiệu lực và an toàn.
  </p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <p style="font-size: 11px; color: #9ca3af;">— VoxStudio Team</p>
</body></html>
"""
    return subject, html, text
