# VoxStudio Admin Web

Next.js 15 admin console cho VoxStudio. Deploy lên Vercel free tier.

## Dev

```bash
cd admin
npm install
npm run dev
# → http://localhost:3001
```

Mặc định gọi backend ở `http://localhost:8000`. Đổi qua env:

```bash
NEXT_PUBLIC_API_URL=https://api.voxstudio.app npm run dev
```

## Deploy Vercel

```bash
cd admin
vercel
# Khi Vercel hỏi project settings:
#   Framework: Next.js
#   Root directory: ./
# Sau deploy, set env Production:
#   NEXT_PUBLIC_API_URL = https://api.voxstudio.app  (hoặc ngrok URL)
```

## Pages

| Route         | Chức năng |
|---------------|-----------|
| `/login`      | Đăng nhập bằng tài khoản admin backend |
| `/`           | Dashboard — users, DAU/MAU, job stats, plan breakdown |
| `/users`      | Quản lý user: tìm, lọc, sửa plan/role/banned |
| `/jobs`       | Xem GPU queue, huỷ job đang chạy/chờ |
| `/audit`      | Xem lịch sử action toàn hệ thống |
| `/flags`      | Toggle feature flag, rollout %, whitelist |
| `/plans`      | Sửa giá gói, LTD, on/off hiển thị |
| `/health`     | Kiểm tra DB / GPU / worker / VRAM |

## Auth

- Đăng nhập gọi `/api/v1/auth/login` rồi check `user.role === "admin"`.
- JWT lưu ở `localStorage: voxstudio-admin:token`.
- Route không phải `/login` redirect về `/login` nếu không có token hoặc không admin.
