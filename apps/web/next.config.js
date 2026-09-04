//@ts-check
const backendHost = process.env.PLAYLARR_SERVER_HOST ?? '127.0.0.1';
const backendPort = process.env.PLAYLARR_SERVER_PORT ?? '3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://${backendHost}:${backendPort}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
