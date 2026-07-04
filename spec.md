# Business Management Platform (BMP) — Complete Software Specification

See `/Users/sombuddhachatterjee/.claude/plans/rosy-puzzling-cosmos.md` for the Phase 1 (Foundation)
implementation plan derived from this spec.

The application is built incrementally in phases, each fully functional before the next begins:

1. **Foundation** — monorepo, Docker environment, auth (JWT + refresh), RBAC, user management,
   basic dashboard, shared UI components, logging, file upload infrastructure.
2. **Core Tender Management** — Tender CRUD, status workflow, document management with versioning,
   search/filters, audit logging, dashboard widgets, notifications.
3. **BOQ & Estimation** — BOQ upload (Excel/PDF), parser, editable grid, rate analysis, historical
   rates, cost estimation, estimate comparison.
4. **Procurement** — Vendor management, RFQ workflow, comparative statements, purchase orders,
   goods receipt, vendor performance tracking.
5. **Project Execution** — Convert tender to project, milestones, material/labor tracking, billing,
   project costing, progress dashboard.
6. **Finance** — Expenses, invoices, payments, GST, cash/bank books, financial reports.
7. **Reporting & Intelligence** — Custom report builder, advanced dashboards, PDF/Excel exports,
   full-text search, analytics, KPI tracking.
8. **Production Readiness** — Automated testing, performance optimization, security hardening,
   CI/CD pipelines, deployment documentation, backup/recovery, monitoring/logging.

Technology stack: React 19 / Next.js (App Router) / TypeScript / TailwindCSS / shadcn/ui frontend;
Node.js / Express / TypeScript / Prisma / PostgreSQL / Redis / BullMQ backend; JWT auth; AWS
S3-compatible storage (MinIO in dev); Docker Compose deployment with NGINX reverse proxy.
