import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'sharp', 'pdfjs-dist'],
};

export default nextConfig;
