import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(currentDir, "../../.env.test") });
