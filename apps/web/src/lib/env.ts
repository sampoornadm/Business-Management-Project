// Relative on purpose: resolves against whatever origin the page was actually loaded
// from (localhost, LAN IP, a public tunnel URL) via the Next.js rewrite in
// next.config.mjs that proxies /api/v1/* to the local API server — one same-origin
// path works everywhere instead of coordinating an absolute URL per network.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
