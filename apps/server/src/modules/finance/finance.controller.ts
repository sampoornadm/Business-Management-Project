import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { FinanceService } from "./finance.service.js";
import type {
  CreateBankAccountBody,
  CreateExpenseBody,
  CreateInvoiceBody,
  CreateInvoiceFromBillBody,
  CreatePaymentBody,
  ListExpensesQueryParsed,
  ListInvoicesQueryParsed,
  UpdateBankAccountBody,
  UpdateExpenseBody,
  UpdateInvoiceBody,
} from "./finance.validation.js";

export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // Bank accounts
  listBankAccounts = asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly === "true";
    const accounts = await this.financeService.listBankAccounts(req.user!.businessId, activeOnly);
    sendSuccess(res, accounts, "Bank accounts retrieved");
  });

  getBankAccount = asyncHandler(async (req, res) => {
    const account = await this.financeService.getBankAccount(req.params.id!, req.user!.businessId);
    sendSuccess(res, account, "Bank account retrieved");
  });

  createBankAccount = asyncHandler(async (req, res) => {
    const body = req.body as CreateBankAccountBody;
    const account = await this.financeService.createBankAccount(body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, account, "Bank account created", 201);
  });

  updateBankAccount = asyncHandler(async (req, res) => {
    const body = req.body as UpdateBankAccountBody;
    const account = await this.financeService.updateBankAccount(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, account, "Bank account updated");
  });

  deleteBankAccount = asyncHandler(async (req, res) => {
    await this.financeService.deleteBankAccount(req.params.id!, req.user!.id, req.user!.businessId);
    sendSuccess(res, null, "Bank account deleted");
  });

  // Invoices
  listInvoices = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListInvoicesQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.financeService.listInvoices(pagination, {
      businessId: req.user!.businessId,
      status: query.status,
      projectId: query.projectId,
    });
    sendSuccess(res, result, "Invoices retrieved");
  });

  getInvoice = asyncHandler(async (req, res) => {
    const invoice = await this.financeService.getInvoice(req.params.id!, req.user!.businessId);
    sendSuccess(res, invoice, "Invoice retrieved");
  });

  createInvoice = asyncHandler(async (req, res) => {
    const body = req.body as CreateInvoiceBody;
    const invoice = await this.financeService.createInvoice(body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, invoice, "Invoice created", 201);
  });

  createInvoiceFromBill = asyncHandler(async (req, res) => {
    const body = req.body as CreateInvoiceFromBillBody;
    const invoice = await this.financeService.createInvoiceFromBill(body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, invoice, "Invoice created from bill", 201);
  });

  updateInvoice = asyncHandler(async (req, res) => {
    const body = req.body as UpdateInvoiceBody;
    const invoice = await this.financeService.updateInvoice(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, invoice, "Invoice updated");
  });

  recordInvoicePayment = asyncHandler(async (req, res) => {
    const body = req.body as CreatePaymentBody;
    const invoice = await this.financeService.recordInvoicePayment(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, invoice, "Payment recorded", 201);
  });

  // Expenses
  listExpenses = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListExpensesQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.financeService.listExpenses(pagination, {
      businessId: req.user!.businessId,
      status: query.status,
      category: query.category,
      projectId: query.projectId,
      vendorId: query.vendorId,
    });
    sendSuccess(res, result, "Expenses retrieved");
  });

  getExpense = asyncHandler(async (req, res) => {
    const expense = await this.financeService.getExpense(req.params.id!, req.user!.businessId);
    sendSuccess(res, expense, "Expense retrieved");
  });

  createExpense = asyncHandler(async (req, res) => {
    const body = req.body as CreateExpenseBody;
    const expense = await this.financeService.createExpense(body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, expense, "Expense created", 201);
  });

  updateExpense = asyncHandler(async (req, res) => {
    const body = req.body as UpdateExpenseBody;
    const expense = await this.financeService.updateExpense(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, expense, "Expense updated");
  });

  recordExpensePayment = asyncHandler(async (req, res) => {
    const body = req.body as CreatePaymentBody;
    const expense = await this.financeService.recordExpensePayment(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, expense, "Payment recorded", 201);
  });

  // Purchase order payments (Finance-side; PO delivery status stays Procurement's concern)
  recordPurchaseOrderPayment = asyncHandler(async (req, res) => {
    const body = req.body as CreatePaymentBody;
    const payments = await this.financeService.recordPurchaseOrderPayment(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, payments, "Payment recorded", 201);
  });

  listPurchaseOrderPayments = asyncHandler(async (req, res) => {
    const payments = await this.financeService.listPurchaseOrderPayments(req.params.id!, req.user!.businessId);
    sendSuccess(res, payments, "Payments retrieved");
  });

  // Reports
  getSummary = asyncHandler(async (req, res) => {
    const summary = await this.financeService.getSummary(req.user!.businessId);
    sendSuccess(res, summary, "Finance summary retrieved");
  });

  getCashBook = asyncHandler(async (req, res) => {
    const entries = await this.financeService.getCashBook(req.user!.businessId);
    sendSuccess(res, entries, "Cash book retrieved");
  });

  getBankBook = asyncHandler(async (req, res) => {
    const entries = await this.financeService.getBankBook(req.params.bankAccountId!, req.user!.businessId);
    sendSuccess(res, entries, "Bank book retrieved");
  });
}
