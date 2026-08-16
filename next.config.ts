import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Thumbnails are served from Convex storage HTTP URLs (local dev or cloud).
  images: { unoptimized: true },
};

export default nextConfig;
