import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "playwright-core"],
};

export default nextConfig;
