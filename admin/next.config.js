/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Override khi deploy Vercel: NEXT_PUBLIC_API_URL=https://api.voxstudio.app
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
};
module.exports = nextConfig;
