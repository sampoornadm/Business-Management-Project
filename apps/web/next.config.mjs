import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(currentDir, "../.."),
  transpilePackages: ["@bmp/ui", "@bmp/types"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack(config) {
    // @bmp/types and @bmp/ui are unbuilt TS source packages whose relative
    // imports use explicit ".js" extensions (required for Node ESM in
    // apps/server). Webpack needs to be told that a ".js" specifier may
    // actually resolve to a sibling ".ts"/".tsx" file.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
