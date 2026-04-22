# VoxStudio — Chính sách Bảo mật / Privacy Policy

**Hiệu lực: 2026-04-22**

VoxStudio ("chúng tôi", "ứng dụng") tôn trọng quyền riêng tư của bạn. Tài
liệu này giải thích dữ liệu nào được thu thập, mục đích sử dụng, và quyền
của bạn.

---

## 1. Thông tin chúng tôi thu thập

### 1.1 Thông tin tài khoản

Khi bạn đăng ký hoặc đăng nhập bằng Google, chúng tôi thu thập:

- **Email** — để xác định tài khoản + gửi thông báo quan trọng.
- **Tên** — hiển thị trong giao diện.
- **Ảnh đại diện** (nếu đăng nhập Google) — hiển thị trong ứng dụng.
- **Google Account ID** (sub) — liên kết đăng nhập.

Chúng tôi **không** truy cập bất kỳ thông tin nào khác trong tài khoản
Google của bạn (Gmail, Drive, Contacts, v.v.).

### 1.2 Dữ liệu người dùng tạo

- **Video/audio bạn upload** — lưu tạm trong thư mục làm việc cục bộ trên
  máy tính của bạn hoặc server xử lý (tuỳ config). Không chia sẻ với bên thứ 3.
- **Giọng nói clone** (nếu bạn tạo) — lưu cục bộ. Không training lại model
  công khai.
- **Phụ đề, bản dịch, kết quả dubbing** — lưu cục bộ hoặc server của bạn.

### 1.3 Dữ liệu kỹ thuật

- **Version app** — để tương thích API.
- **Log lỗi** (chỉ khi bạn chủ động gửi báo cáo) — không bao gồm credentials.

---

## 2. Mục đích sử dụng

Chúng tôi dùng dữ liệu trên để:

- Xác thực tài khoản.
- Cung cấp tính năng: dubbing, TTS, clone giọng, dịch thuật, tải video.
- Đồng bộ dữ liệu giữa các máy (tuỳ chọn).
- Gửi thông báo sản phẩm quan trọng qua email (có thể tắt).

---

## 3. Chia sẻ dữ liệu

Chúng tôi **KHÔNG** bán, cho thuê, hoặc chia sẻ dữ liệu cá nhân của bạn
với bên thứ 3 để quảng cáo.

Dữ liệu chỉ được chia sẻ khi:

- **Dịch vụ AI bạn chọn** (OpenAI, Anthropic, DeepL, Google Translate…): khi
  bạn bật dịch/transcribe qua API của họ, text của bạn được gửi đến nhà
  cung cấp đó theo điều khoản riêng của họ. API keys bạn paste vào app chỉ
  lưu trên máy bạn (OS Keychain), không gửi về server chúng tôi.
- **Yêu cầu pháp lý** — khi có lệnh của cơ quan có thẩm quyền.

---

## 4. Bảo mật

- Mật khẩu mã hoá bằng bcrypt (không lưu plain text).
- Session qua JWT 7 ngày.
- API keys của bên thứ 3 lưu qua **OS Keychain** (macOS Keychain,
  Windows DPAPI, Linux libsecret).
- Kết nối HTTPS cho mọi API cloud.
- Video/audio gốc lưu trên máy bạn, không upload server chúng tôi trừ khi
  bạn tự deploy.

---

## 5. Quyền của bạn

Bạn có quyền:

- **Xem + chỉnh sửa** thông tin tài khoản (trong `Cài đặt → Tài khoản`).
- **Xuất dữ liệu** — tải toàn bộ project + voices (`Cài đặt → Bảo mật`).
- **Xoá tài khoản** — xoá vĩnh viễn sau 30 ngày (`Cài đặt → Tài khoản`).
- **Rút quyền Google** — vào https://myaccount.google.com/permissions
  để thu hồi quyền truy cập.

---

## 6. Cookies + Lưu trữ cục bộ

App dùng:

- **localStorage** (trong Electron) để lưu: theme, ngôn ngữ, output folder,
  lịch sử download.
- **OS Keychain** để lưu API keys của bên thứ 3.
- **SQLite file cục bộ** (trên server của bạn) để lưu user + project.

Không dùng cookies tracking hoặc analytics 3rd party.

---

## 7. Trẻ em dưới 13 tuổi

App không hướng tới và không cố tình thu thập dữ liệu trẻ em dưới 13.

---

## 8. Thay đổi chính sách

Chúng tôi có thể cập nhật Privacy Policy. Thay đổi quan trọng sẽ được
thông báo qua email + trong app trước khi có hiệu lực.

---

## 9. Liên hệ

- **Email:** `hello@voxstudio.app`
- **Issues:** https://github.com/thuantiensd/VoxStudio/issues

---

<small>Policy version 1.0 · 2026-04-22</small>
