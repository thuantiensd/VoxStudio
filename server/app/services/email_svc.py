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
from datetime import datetime
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


def payment_confirmed_email(
    name: str, plan_name: str, ref_code: str,
    amount_vnd: int, is_ltd: bool,
) -> tuple[str, str, str]:
    """Trả (subject, html, text) cho email báo đã xác nhận thanh toán.

    Email được thiết kế để bật mở trên cả light/dark client, dùng table-based
    layout cho tương thích Outlook/Gmail/Apple Mail.
    """
    plan_display = f"{plan_name}{' — Trọn đời' if is_ltd else ''}"
    amount_str = f"{amount_vnd:,}đ".replace(",", ".")
    paid_at_str = datetime.utcnow().strftime("%d/%m/%Y %H:%M UTC")
    duration_label = "Trọn đời — không hết hạn" if is_ltd else "1 tháng kể từ hôm nay"

    # Liệt kê quyền lợi gói — copy ngắn để không quá dài
    if is_ltd:
        perks = [
            "Toàn bộ tính năng cao cấp — kích hoạt trọn đời, không cần gia hạn",
            "Ưu tiên hàng đợi GPU & xử lý nhanh hơn",
            "Hỗ trợ kỹ thuật ưu tiên qua email & Zalo",
            "Cập nhật miễn phí mọi bản nâng cấp tương lai",
        ]
    else:
        perks = [
            "Mở khoá toàn bộ tính năng của gói",
            "Ưu tiên hàng đợi GPU — xuất kết quả nhanh hơn",
            "Tải video không giới hạn (Pro/Studio)",
            "Hỗ trợ qua email — phản hồi trong 24h",
        ]

    subject = f"✓ Thanh toán đã xác nhận — Gói {plan_display} đã kích hoạt"

    # ── Plain-text version ───────────────────────────────────
    text = f"""VoxStudio — Xác nhận thanh toán

Chào {name},

Chúng tôi đã nhận và xác nhận thanh toán của bạn. Tài khoản đã được
nâng cấp ngay lập tức — bạn có thể bắt đầu sử dụng các tính năng mới.

CHI TIẾT GIAO DỊCH
─────────────────────────────────────────
  Mã giao dịch:    {ref_code}
  Gói:             {plan_display}
  Số tiền:         {amount_str}
  Thời gian:       {paid_at_str}
  Hiệu lực:        {duration_label}

QUYỀN LỢI GÓI CỦA BẠN
─────────────────────────────────────────
""" + "\n".join(f"  • {p}" for p in perks) + f"""

BƯỚC TIẾP THEO
─────────────────────────────────────────
  1. Mở app VoxStudio (đăng nhập lại nếu cần để cập nhật trạng thái).
  2. Vào Settings → Gói dịch vụ để xem tình trạng gói.
  3. Bắt đầu tạo project — mọi quota mới đã được áp dụng.

HỖ TRỢ
─────────────────────────────────────────
Mọi thắc mắc về giao dịch hoặc kỹ thuật, vui lòng reply email này
(voxstudio.vn@gmail.com) — chúng tôi phản hồi trong 24h.

Vui lòng giữ lại email này như biên lai chính thức.

Cảm ơn bạn đã tin tưởng và đồng hành cùng VoxStudio!

— Đội ngũ VoxStudio
voxstudio.vn@gmail.com

────
Email tự động — vui lòng không xoá. Nếu bạn không thực hiện giao dịch
này, hãy phản hồi ngay để chúng tôi xử lý.
"""

    # ── HTML version ─────────────────────────────────────────
    perks_html = "".join(
        f"""
      <tr>
        <td valign="top" style="padding: 8px 0; width: 24px;">
          <div style="width: 18px; height: 18px; border-radius: 50%;
                      background: #ecfdf5; color: #059669;
                      font-size: 12px; font-weight: 700; line-height: 18px;
                      text-align: center;">✓</div>
        </td>
        <td style="padding: 8px 0 8px 10px; font-size: 14px;
                   color: #374151; line-height: 1.5;">{p}</td>
      </tr>
"""
        for p in perks
    )

    html = f"""\
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Xác nhận thanh toán VoxStudio</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6;
             font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             color: #1f2937;">

  <div style="display: none; max-height: 0; overflow: hidden;
              font-size: 1px; line-height: 1px; color: #f3f4f6;">
    Gói {plan_display} đã được kích hoạt — cảm ơn bạn đã tin tưởng VoxStudio.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background: #f3f4f6; padding: 32px 16px;">
    <tr><td align="center">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="max-width: 600px; width: 100%;
                    background: #ffffff; border-radius: 16px; overflow: hidden;
                    box-shadow: 0 6px 28px rgba(0,0,0,0.08);">

        <!-- Header banner -->
        <tr>
          <td style="background: linear-gradient(135deg, #6c5cf2 0%, #ec4899 100%);
                     padding: 28px 28px 24px; text-align: center;">
            <div style="font-size: 24px; font-weight: 800; color: #fff;
                        letter-spacing: -0.5px; margin-bottom: 4px;">
              VoxStudio
            </div>
            <div style="font-size: 12px; color: rgba(255,255,255,0.82);
                        letter-spacing: 0.5px; text-transform: uppercase;">
              Biên lai thanh toán
            </div>
          </td>
        </tr>

        <!-- Success badge + headline -->
        <tr>
          <td style="padding: 32px 32px 8px; text-align: center;">
            <div style="display: inline-block; width: 64px; height: 64px;
                        line-height: 64px; border-radius: 50%;
                        background: linear-gradient(135deg, #10b981, #059669);
                        color: #fff; font-size: 32px; font-weight: 800;
                        margin-bottom: 14px;
                        box-shadow: 0 6px 20px rgba(16,185,129,0.35);">
              ✓
            </div>
            <h1 style="margin: 0 0 6px; font-size: 22px; font-weight: 700;
                       color: #111827;">
              Thanh toán thành công
            </h1>
            <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.55;">
              Gói <b style="color: #6c5cf2;">{plan_display}</b>
              đã được kích hoạt cho tài khoản của bạn.
            </p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding: 24px 32px 4px; font-size: 14px; color: #374151;
                     line-height: 1.65;">
            Chào <b>{name}</b>,<br>
            Chúng tôi đã nhận và xác nhận thanh toán của bạn. Tài khoản đã được
            nâng cấp <b>ngay lập tức</b> — bạn có thể bắt đầu sử dụng các tính
            năng mới.
          </td>
        </tr>

        <!-- Transaction details card -->
        <tr>
          <td style="padding: 18px 32px 4px;">
            <div style="background: #f9fafb; border: 1px solid #e5e7eb;
                        border-radius: 12px; overflow: hidden;">
              <div style="padding: 12px 16px; background: #f3f4f6;
                          border-bottom: 1px solid #e5e7eb;
                          font-size: 11px; font-weight: 700;
                          color: #6b7280; letter-spacing: 0.6px;
                          text-transform: uppercase;">
                Chi tiết giao dịch
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="font-size: 14px;">
                <tr>
                  <td style="padding: 11px 16px; color: #6b7280; width: 40%;
                             border-bottom: 1px solid #f3f4f6;">Mã giao dịch</td>
                  <td style="padding: 11px 16px; font-family: 'SF Mono', Menlo, monospace;
                             font-weight: 700; color: #111827;
                             border-bottom: 1px solid #f3f4f6;">{ref_code}</td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; color: #6b7280;
                             border-bottom: 1px solid #f3f4f6;">Gói</td>
                  <td style="padding: 11px 16px; font-weight: 600; color: #111827;
                             border-bottom: 1px solid #f3f4f6;">{plan_display}</td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; color: #6b7280;
                             border-bottom: 1px solid #f3f4f6;">Số tiền</td>
                  <td style="padding: 11px 16px; font-weight: 700;
                             color: #059669; font-size: 15px;
                             border-bottom: 1px solid #f3f4f6;">{amount_str}</td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; color: #6b7280;
                             border-bottom: 1px solid #f3f4f6;">Thời gian</td>
                  <td style="padding: 11px 16px; color: #111827;
                             border-bottom: 1px solid #f3f4f6;">{paid_at_str}</td>
                </tr>
                <tr>
                  <td style="padding: 11px 16px; color: #6b7280;">Hiệu lực</td>
                  <td style="padding: 11px 16px; color: #111827;
                             font-weight: 600;">{duration_label}</td>
                </tr>
              </table>
            </div>
          </td>
        </tr>

        <!-- Perks -->
        <tr>
          <td style="padding: 22px 32px 4px;">
            <div style="font-size: 11px; font-weight: 700; color: #6b7280;
                        letter-spacing: 0.6px; text-transform: uppercase;
                        margin-bottom: 8px;">
              Quyền lợi gói của bạn
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              {perks_html}
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding: 24px 32px 8px; text-align: center;">
            <p style="margin: 0 0 14px; font-size: 13px; color: #6b7280;">
              Mở app VoxStudio để bắt đầu sử dụng. Nếu đang đăng nhập, app sẽ
              tự cập nhật trạng thái gói trong vòng 1 phút.
            </p>
            <a href="https://voxstudio.vn"
               style="display: inline-block; padding: 12px 26px; border-radius: 8px;
                      background: linear-gradient(135deg, #6c5cf2 0%, #ec4899 100%);
                      color: #fff; font-size: 14px; font-weight: 600;
                      text-decoration: none;
                      box-shadow: 0 6px 18px rgba(108,92,242,0.35);">
              Mở VoxStudio
            </a>
          </td>
        </tr>

        <!-- Support box -->
        <tr>
          <td style="padding: 22px 32px 4px;">
            <div style="background: #fffbeb; border: 1px solid #fde68a;
                        border-radius: 10px; padding: 14px 16px;
                        font-size: 13px; color: #78350f; line-height: 1.6;">
              <b style="color: #92400e;">Cần hỗ trợ?</b> Reply email này
              hoặc gửi tới
              <a href="mailto:voxstudio.vn@gmail.com"
                 style="color: #92400e; text-decoration: underline;">voxstudio.vn@gmail.com</a>
              — chúng tôi phản hồi trong vòng 24h. Vui lòng <b>giữ lại email
              này như biên lai chính thức</b>.
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 28px 32px 32px; border-top: 1px solid #f3f4f6;
                     margin-top: 16px;">
            <p style="margin: 0 0 4px; font-size: 13px; color: #374151;
                      font-weight: 600;">
              Cảm ơn bạn đã tin tưởng và đồng hành cùng VoxStudio!
            </p>
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">
              — Đội ngũ VoxStudio
            </p>
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 16px 0;">
            <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.6;">
              Email tự động gửi sau khi giao dịch được xác nhận. Nếu bạn
              <b>không thực hiện</b> giao dịch này, vui lòng phản hồi ngay
              để chúng tôi xử lý.<br>
              © VoxStudio · voxstudio.vn@gmail.com
            </p>
          </td>
        </tr>
      </table>

    </td></tr>
  </table>
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
