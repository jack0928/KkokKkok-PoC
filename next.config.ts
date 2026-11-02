import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.KKOK_DIST_DIR || ".next",
  poweredByHeader: false,
  // Opt in for Windows environments where parallel build workers hit EPERM.
  experimental: process.env.KKOK_SERIAL_BUILD === "1"
    ? { webpackBuildWorker: false, cpus: 1 }
    : undefined,
};

export default nextConfig;
