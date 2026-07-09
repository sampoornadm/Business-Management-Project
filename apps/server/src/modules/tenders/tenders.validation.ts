import { TENDER_ASSIGNEE_ROLES, TENDER_PRIORITIES, TENDER_STATUSES } from "@bmp/types";
import { z } from "zod";

const priceField = z.coerce.number().nonnegative().optional();

export const createTenderSchema = z.object({
  tenderNumber: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  department: z.string().min(1).max(150),
  clientId: z.string().uuid(),
  type: z.string().min(1).max(50),
  category: z.string().min(1).max(50),
  location: z.string().min(1).max(200),
  state: z.string().min(1).max(100),
  estimatedCost: z.coerce.number().nonnegative(),
  emdAmount: priceField,
  tenderFee: priceField,
  documentFee: priceField,
  submissionDate: z.coerce.date(),
  openingDate: z.coerce.date().optional(),
  validityPeriodDays: z.coerce.number().int().positive().optional(),
  priority: z.enum(TENDER_PRIORITIES).optional(),
  description: z.string().max(5000).optional(),
  remarks: z.string().max(5000).optional(),
  dealingOfficerName: z.string().max(200).optional(),
  dealingOfficerEmail: z.string().email().max(200).optional(),
  dealingOfficerPhone: z.string().max(30).optional(),
});
export type CreateTenderBody = z.infer<typeof createTenderSchema>;

export const updateTenderSchema = createTenderSchema.partial();
export type UpdateTenderBody = z.infer<typeof updateTenderSchema>;

export const changeTenderStatusSchema = z.object({
  status: z.enum(TENDER_STATUSES),
  remarks: z.string().max(2000).optional(),
  winnerName: z.string().max(200).optional(),
  winningBidAmount: z.coerce.number().nonnegative().optional(),
  lossReason: z.string().max(2000).optional(),
});
export type ChangeTenderStatusBody = z.infer<typeof changeTenderStatusSchema>;

export const addAssigneeSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(TENDER_ASSIGNEE_ROLES).optional(),
});
export type AddAssigneeBody = z.infer<typeof addAssigneeSchema>;

export const createCompetitorSchema = z.object({
  competitorName: z.string().min(1).max(200),
  bidAmount: priceField,
  isWinningBid: z.boolean().optional(),
  remarks: z.string().max(2000).optional(),
});
export type CreateCompetitorBody = z.infer<typeof createCompetitorSchema>;

export const updateCompetitorSchema = createCompetitorSchema.partial();
export type UpdateCompetitorBody = z.infer<typeof updateCompetitorSchema>;

export const setTenderTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()),
});
export type SetTenderTagsBody = z.infer<typeof setTenderTagsSchema>;

export const listTendersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  status: z.enum(TENDER_STATUSES).optional(),
  clientId: z.string().uuid().optional(),
  department: z.string().optional(),
  priority: z.enum(TENDER_PRIORITIES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  submissionDateFrom: z.coerce.date().optional(),
  submissionDateTo: z.coerce.date().optional(),
});
export type ListTendersQueryParsed = z.infer<typeof listTendersQuerySchema>;

export const uploadTenderDocumentSchema = z.object({
  documentType: z.string().min(1),
  replacesAttachmentId: z.string().uuid().optional(),
});
export type UploadTenderDocumentBody = z.infer<typeof uploadTenderDocumentSchema>;
