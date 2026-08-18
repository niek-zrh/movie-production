import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Thumbnails are served from Convex storage HTTP URLs (local dev or cloud).
  images: { unoptimized: true },
  // Self-contained server bundle for the Docker runner stage.
  output: "standalone",
};

export default nextConfig;
