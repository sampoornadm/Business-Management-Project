import { nextjsConfig } from "@bmp/config/eslint/nextjs";

const config = [...nextjsConfig, { ignores: [".next/**", "next-env.d.ts"] }];

export default config;
