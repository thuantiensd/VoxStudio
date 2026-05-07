import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Tắt Strict Mode trong dev — cobe (WebGL globe) bị break do double-mount
  // useEffect gọi destroy() rồi re-init khiến animation loop chết.
  // Production chạy đúng (StrictMode chỉ active dev). Sau này có thể thay
  // cobe bằng custom three.js implementation nếu muốn re-enable strict mode.
  reactStrictMode: false,
  experimental: {
    // Ready for server actions, etc
  },
};

export default withNextIntl(nextConfig);
