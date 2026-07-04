import { nodeConfig } from "@bmp/config/eslint/node";

export default [...nodeConfig, { ignores: ["generated/**"] }];
