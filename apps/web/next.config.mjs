import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Lets a second `next dev` (scripts/dev-autologin.sh) run beside the main one without both
  // fighting over .next — see the .next race note in CLAUDE.md.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: path.join(currentDir, "../.."),
  transpilePackages: ["@bmp/ui", "@bmp/types"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Proxies API calls through this same server (same-origin from the browser's POV) so
  // NEXT_PUBLIC_API_URL can stay relative — one public URL (or LAN IP) covers web+API
  // together, no separate CORS/cross-site-cookie setup needed per network/tunnel.
  //
  // The attachments rewrite exists for a different reason: S3 presigned URLs (see
  // apps/server/.../s3.service.ts#getPresignedUrl) are signed against S3_ENDPOINT's own
  // Host header (SigV4). A reverse proxy that rewrites Host when forwarding — which a
  // public tunnel does — breaks that signature. Routing through this same-process
  // rewrite instead means the actual request to MinIO always has Host: localhost:9000,
  // exactly what was signed, regardless of what public URL the browser used to get here.
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: "http://localhost:4000/api/v1/:path*" },
      {
        source: `/${process.env.S3_BUCKET ?? "bmp-attachments"}/:path*`,
        destination: `http://localhost:9000/${process.env.S3_BUCKET ?? "bmp-attachments"}/:path*`,
      },
    ];
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
