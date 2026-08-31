import { prisma } from "../../infra/prisma/client.js";

import { ContactsController } from "./contacts.controller.js";
import { ContactsRepository } from "./contacts.repository.js";
import { createContactsRouter } from "./contacts.routes.js";
import { ContactsService } from "./contacts.service.js";

export const contactsRepository = new ContactsRepository(prisma);
export const contactsService = new ContactsService(contactsRepository);
const contactsController = new ContactsController(contactsService);

export const contactsRouter = createContactsRouter(contactsController);
