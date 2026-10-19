/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prevent webpack from trying to bundle Node.js-only packages used in API routes
  serverExternalPackages: ["jimp", "jsqr", "cheerio", "dns", "https"],
};

export default nextConfig;
