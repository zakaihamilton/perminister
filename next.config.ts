import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Railway replaces x-forwarded-host with its own host when proxying actions.
      allowedOrigins: ["perminister.com", "www.perminister.com"],
    },
  },
};

export default nextConfig;
