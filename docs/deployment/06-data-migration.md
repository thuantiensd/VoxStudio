# 06 — Data Migration: SQLite local → Postgres production

> Mục tiêu: chuyển dữ liệu từ `server/voxstudio.db` (SQLite local) lên Postgres VPS, seed plans + tạo admin user.

## Trường hợp 1: Start fresh (KHUYẾN NGHỊ)

Bỏ data dev cũ, bắt đầu sạch trên production.

### Bước 1.1 — Trigger migrations từ VPS

Migration script ([server/app/db/migrations.py](../../server/app/db/migrations.py)) tự chạy khi FastAPI startup. Nên chỉ cần restart service VPS:

```bash
# Trên VPS
sudo systemctl restart voxstudio-api
sudo journalctl -u voxstudio-api -f
```

Log mong đợi:

```
[lifespan] worker disabled — API-only mode
Added column users.role
Added column users.is_banned
...
[seed] inserted plan: free
[seed] inserted plan: pro
[seed] inserted plan: business
```

Verify trên Postgres:

```bash
sudo -u postgres psql voxstudio
\dt                    # liệt kê bảng
SELECT * FROM plans;   # 3 plans
\q
```

### Bước 1.2 — Tạo admin user qua ENV (cách đơn giản nhất)

[migrations.py:238](../../server/app/db/migrations.py#L238) tự promote user thành admin nếu email match `ADMIN_EMAILS` env var.

1. Đăng ký tài khoản qua web bình thường:

```bash
curl -X POST https://api.voxstudio.app/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@voxstudio.app","password":"<STRONG_PASSWORD>"}'
```

2. Set env trên VPS để promote thành admin:

```bash
# Sửa /opt/voxstudio/server/.env
echo 'ADMIN_EMAILS=admin@voxstudio.app' >> /opt/voxstudio/server/.env
sudo systemctl restart voxstudio-api
```

3. Verify:

```bash
sudo -u postgres psql voxstudio -c \
  "SELECT email, role FROM users WHERE email='admin@voxstudio.app';"
# → role=admin
```

4. Login admin từ `https://admin.voxstudio.app/login`.

### Bước 1.3 — Verify email (skip cho admin)

Email verify token được gửi qua SMTP khi register. Cho admin user, manual verify:

```sql
sudo -u postgres psql voxstudio -c \
  "UPDATE users SET email_verified=true WHERE email='admin@voxstudio.app';"
```

## Trường hợp 2: Migrate từ SQLite local

Nếu bạn đã có data dev quan trọng (users, voices, payments) ở `server/voxstudio.db` và muốn giữ.

### Bước 2.1 — Dump SQLite

```bash
# Trên máy local
cd /Users/tienthuan/Desktop/VoxStudio/server
sqlite3 voxstudio.db .dump > voxstudio_dump.sql

# Xem kích thước
wc -l voxstudio_dump.sql
```

### Bước 2.2 — Convert SQLite → Postgres

SQLite SQL không tương thích Postgres 100% (BOOLEAN khác, AUTOINCREMENT, datetime format...). Dùng `pgloader`:

```bash
# Trên máy local
brew install pgloader  # macOS
# Hoặc: sudo apt install pgloader  (Linux)

# Tạo file lệnh load.lisp
cat > /tmp/load.lisp <<EOF
LOAD DATABASE
  FROM sqlite:///Users/tienthuan/Desktop/VoxStudio/server/voxstudio.db
  INTO postgresql://voxstudio:<PASSWORD>@<VPS_IP>:5432/voxstudio

WITH include drop, create tables, create indexes, reset sequences

CAST type datetime to timestamptz drop default drop not null using zero-dates-to-null,
     type date drop default drop not null using zero-dates-to-null;
EOF

pgloader /tmp/load.lisp
```

### Bước 2.3 — Migrate file storage (dubbing_projects/, voices/)

Files local cũng cần copy lên DO Spaces hoặc trực tiếp lên RunPod Network Volume.

**Option A — Lên DO Spaces:**

```bash
# Cài rclone trên máy local
brew install rclone

# Setup remote DO Spaces
rclone config
# > New remote: name=do, type=s3, provider=DigitalOcean
# > Access key + secret từ DO Spaces
# > endpoint: sgp1.digitaloceanspaces.com

cd /Users/tienthuan/Desktop/VoxStudio/server
rclone sync dubbing_projects/ do:voxstudio-files/dubbing_projects/ -v
rclone sync voices/ do:voxstudio-files/voices/ -v
```

**Option B — Lên RunPod Network Volume:**

```bash
# Trên máy local — rsync qua SSH RunPod
rsync -avz -e "ssh -p <PORT> -i ~/.ssh/id_ed25519" \
  /Users/tienthuan/Desktop/VoxStudio/server/dubbing_projects/ \
  root@<pod-id>.proxy.runpod.net:/workspace/dubbing_projects/

rsync -avz -e "ssh -p <PORT> -i ~/.ssh/id_ed25519" \
  /Users/tienthuan/Desktop/VoxStudio/server/voices/ \
  root@<pod-id>.proxy.runpod.net:/workspace/voices/
```

> ⚠️ Trước khi rsync, tạm xóa các project test trong [server/dubbing_projects/](../../server/dubbing_projects/) để giảm dung lượng. Mỗi project ~100-500MB, hiện đang có ~150 project test.

### Bước 2.4 — Verify data đã migrate

```bash
sudo -u postgres psql voxstudio
SELECT COUNT(*) FROM users;          -- Khớp với SQLite local
SELECT COUNT(*) FROM voices;
SELECT COUNT(*) FROM jobs WHERE status='done';
SELECT COUNT(*) FROM plans;          -- = 3 (free/pro/business)
```

## Bước 3 — Smoke test end-to-end

Sau khi migrate xong, test 1 luồng dubbing để verify VPS ↔ RunPod hoạt động:

```bash
# 1. Login user thường
TOKEN=$(curl -sX POST https://api.voxstudio.app/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"<password>"}' | jq -r .access_token)

# 2. Upload audio + tạo dubbing job
curl -X POST https://api.voxstudio.app/api/v1/dubbing/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sample.mp4" \
  -F "target_lang=vi"
# → trả {"job_id": "abc123", ...}

# 3. Stream progress qua SSE
curl -N "https://api.voxstudio.app/api/v1/jobs/abc123/events" \
  -H "Authorization: Bearer $TOKEN"
# → Stream events: started, progress 10%, 50%, ..., done
```

Nếu thấy event `done` + `result` có URL audio → toàn bộ pipeline OK.

Trên RunPod log nên có:

```
[worker] picked abc123 kind=dubbing user=2
[worker] ✓ job abc123 (dubbing)
```

## Bước 4 — Cleanup data dev

Sau khi production chạy ổn, dọn data dev local:

```bash
# Local — backup trước rồi xóa
mv server/voxstudio.db server/voxstudio.db.bak
rm -rf server/dubbing_projects/*  # giữ folder, xóa nội dung
```

Trên VPS, có thể tắt SQLite fallback bằng cách đảm bảo `DATABASE_URL` luôn được set (đã làm ở [02-server-vps.md](./02-server-vps.md#bước-4--tạo-file-env-cho-vps)).

<a id="tạo-admin-user"></a>
## Tạo admin user (tóm tắt nhanh)

3 cách, từ đơn giản đến manual:

### Cách 1 — Qua ENV `ADMIN_EMAILS` (khuyến nghị)
```bash
echo 'ADMIN_EMAILS=admin@voxstudio.app,you@gmail.com' >> /opt/voxstudio/server/.env
sudo systemctl restart voxstudio-api
# Log: [admin] promoted: admin@voxstudio.app, you@gmail.com
```

### Cách 2 — SQL trực tiếp
```sql
sudo -u postgres psql voxstudio -c \
  "UPDATE users SET role='admin', email_verified=true WHERE email='admin@voxstudio.app';"
```

### Cách 3 — Qua API admin (cần đã có 1 admin từ trước)
```bash
curl -X POST https://api.voxstudio.app/api/v1/admin/users/<id>/promote \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Checklist hoàn thành

- [ ] Postgres có đủ bảng: `users`, `plans`, `jobs`, `voices`, `payments`, `usage_events`, `audit_log`, `feature_flags`
- [ ] `SELECT * FROM plans` trả về 3 plans (free/pro/business)
- [ ] Có ít nhất 1 user với `role='admin'` và `email_verified=true`
- [ ] Login admin từ `https://admin.voxstudio.app/login` thành công
- [ ] Smoke test dubbing job: VPS upload → RunPod chạy → trả kết quả
- [ ] (Nếu migrate cũ) File `dubbing_projects/`, `voices/` đã sync lên Spaces hoặc RunPod Volume

→ Tiếp theo: [07-env-checklist.md](./07-env-checklist.md) — bảng tham chiếu env vars
