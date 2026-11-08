import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/backtest", destination: "/echochart", permanent: true }];
  },
};

export default nextConfig;
