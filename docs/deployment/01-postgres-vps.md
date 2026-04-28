# 01 — Cài Postgres 16 trên VPS DigitalOcean

> Mục tiêu: cài Postgres 16, tạo database `voxstudio`, lấy `DATABASE_URL` để các service khác kết nối.

## Trước khi bắt đầu

- VPS DigitalOcean đã chạy (Ubuntu 22.04+)
- SSH vào được bằng root: `ssh root@<VPS_IP>`
- Mở port 5432 cho RunPod IP (sẽ làm cuối bài)

## Bước 1 — Cài Postgres 16

```bash
ssh root@<VPS_IP>

# Add repo PostgreSQL official (Ubuntu 22.04 mặc định chỉ có Postgres 14)
sudo apt update
sudo apt install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'

sudo apt update
sudo apt install -y postgresql-16

# Verify
sudo systemctl status postgresql
psql --version  # postgres (PostgreSQL) 16.x
```

## Bước 2 — Tạo DB + user `voxstudio`

```bash
sudo -u postgres psql
```

Trong psql shell:

```sql
CREATE USER voxstudio WITH PASSWORD 'CHANGE_THIS_TO_STRONG_PASSWORD';
CREATE DATABASE voxstudio OWNER voxstudio;
GRANT ALL PRIVILEGES ON DATABASE voxstudio TO voxstudio;
\q
```

> Sinh password mạnh: `openssl rand -base64 32` (chạy ở máy local, copy vào).

## Bước 3 — Cho phép kết nối từ xa

Mặc định Postgres chỉ listen `localhost`. Cần cho VPS app + RunPod kết nối.

```bash
# 1. Listen tất cả interface
sudo sed -i "s/^#listen_addresses.*/listen_addresses = '*'/" /etc/postgresql/16/main/postgresql.conf

# 2. Whitelist IP — thêm vào /etc/postgresql/16/main/pg_hba.conf
sudo tee -a /etc/postgresql/16/main/pg_hba.conf <<'EOF'

# VoxStudio: cho phép VPS local + RunPod kết nối
host    voxstudio    voxstudio    127.0.0.1/32          scram-sha-256
host    voxstudio    voxstudio    <RUNPOD_PUBLIC_IP>/32 scram-sha-256
EOF

# 3. Restart
sudo systemctl restart postgresql
```

> RunPod IP lấy ở [03-server-runpod.md](./03-server-runpod.md) (Bước 6 — sau khi tạo Pod). Tạm thời để `0.0.0.0/0` rồi siết lại sau:
> ```
> host    voxstudio    voxstudio    0.0.0.0/0    scram-sha-256
> ```

## Bước 4 — Mở firewall

```bash
sudo ufw allow 5432/tcp
sudo ufw status
```

## Bước 5 — Lấy `DATABASE_URL`

Format dùng cho VoxStudio (SQLAlchemy + asyncpg):

```
DATABASE_URL=postgresql+asyncpg://voxstudio:<PASSWORD>@<VPS_PUBLIC_IP>:5432/voxstudio
```

> ⚠️ Phải có prefix `postgresql+asyncpg://` — không phải `postgres://` thường. Xem [server/requirements.txt](../../server/requirements.txt) — dùng `asyncpg`.

Test kết nối từ máy local:

```bash
psql "postgresql://voxstudio:<PASSWORD>@<VPS_PUBLIC_IP>:5432/voxstudio"
# \dt   → liệt kê bảng (rỗng vì chưa migrate)
# \q
```

## Bước 6 — Bật backup tự động (khuyến nghị)

Postgres self-hosted KHÔNG có auto-backup. Thêm cron dump hàng ngày:

```bash
sudo mkdir -p /var/backups/postgres
sudo tee /etc/cron.daily/pg-backup-voxstudio >/dev/null <<'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d)
sudo -u postgres pg_dump voxstudio | gzip > /var/backups/postgres/voxstudio-$DATE.sql.gz
# Giữ 14 ngày
find /var/backups/postgres -name "voxstudio-*.sql.gz" -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/pg-backup-voxstudio
```

> **Tốt hơn:** rclone backup file `.sql.gz` lên DO Spaces hoặc Backblaze B2 — phòng VPS chết.

## Checklist hoàn thành

- [ ] `sudo systemctl status postgresql` → active (running)
- [ ] `psql -U voxstudio -h <VPS_IP> -d voxstudio` → connect OK từ máy local
- [ ] `DATABASE_URL` đã lưu vào nơi an toàn (1Password / file `.env.production` local, **không commit**)
- [ ] Cron `/etc/cron.daily/pg-backup-voxstudio` tạo xong, test chạy thử: `sudo /etc/cron.daily/pg-backup-voxstudio`
- [ ] `pg_hba.conf` đã whitelist RunPod IP (sau khi tạo Pod ở bước 03)

→ Tiếp theo: [02-server-vps.md](./02-server-vps.md)
