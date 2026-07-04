import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";

import { VendorsController } from "./vendors.controller.js";
import { VendorsRepository } from "./vendors.repository.js";
import { createVendorsRouter } from "./vendors.routes.js";
import { VendorsService } from "./vendors.service.js";

const vendorsRepository = new VendorsRepository(prisma);
export const vendorsService = new VendorsService(vendorsRepository, auditService);
const vendorsController = new VendorsController(vendorsService);

export const vendorsRouter = createVendorsRouter(vendorsController);
export { vendorsRepository };
