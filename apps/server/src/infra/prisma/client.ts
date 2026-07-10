import { prisma as basePrisma } from "@bmp/database";

import { withBusinessScopeGuard } from "./scoped-client.js";

export const prisma = withBusinessScopeGuard(basePrisma);
