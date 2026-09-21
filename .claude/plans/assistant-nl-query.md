# Assistant: natural-language document queries with conversational follow-ups

## Context
The floating Assistant (`apps/web/src/components/assistant/assistant-widget.tsx`, `apps/server/src/modules/assistant/`) is a one-shot keyword lookup: an LLM turns the message into 2-6 search words, then `ReportsService.search` does ILIKE on tender title/number, org/vendor/project names and attachment metadata. It is stateless, has no item/date/status awareness, and RFQ/Bill/PO can never appear. Goal: "show me which tenders I quoted last month for washers" → clickable tender links in chat; "show me the ones which I won" → same query + status filter, re-run.

## Open-source landscape (researched)
- **Text-to-SQL tools** (Vanna, Wren AI, Dataherald, LlamaIndex/LangChain SQL agents): none is a drop-in fit. Vanna/Dataherald are Python, Wren AI is a separate BI platform, and LLM-written SQL is a known multi-tenant/RBAC leak risk (missing tenant predicates, repair loops that widen results). This app already has business scoping + per-entity permissions in Prisma, so we keep those in code.
- **Adopted:** Ollama structured outputs (`format` = JSON schema, grammar-constrained; already local, v0.34), `chrono-node` (MIT, TypeScript) for absolute date phrases, and the "condense question" idea from LlamaIndex chat engines, implemented as a merged *structured query state* instead of a rewritten sentence.
- **Local benchmark (llama3.1:8b, qwen3:4b):** asking the LLM to emit/patch the full query state was unreliable (dropped the washer + date filters on "the ones I won"; invented `QUOTED`/`DRAFT` statuses; one call hung 120s). Asking it only to extract item terms + party name was accurate (11/11 cases) and fast (0.5-1s; first call ~5s model load).

## Approach: LLM as a narrow extractor, code as the executor
Per turn: `message + prior state` →
1. **`parseMessage`** (deterministic): entity (tender/rfq/po/bill/project), statuses (won, lost, sent, received…), `quoted` vs created/deadline date field, date phrase → `{from,to,label}` (relative-period resolver + chrono-node, timezone `Asia/Kolkata`, env `ASSISTANT_TIMEZONE`), follow-up cues (`also`, `and`, `remove/without/any`, `those/ones`).
2. **`extractTerms`** (LLM, schema-constrained, 15s timeout): `itemTerms[]`, `partyText`. On unavailability/timeout/invalid output → heuristic (words after `for/of/with/containing`, stopwords stripped). Terms singularized in code (`washers`→`washer`).
3. **`mergeState`** (deterministic): a follow-up inherits everything the message does not mention; anything it mentions overrides (new item terms replace, unless "also"); entity change drops statuses/party; "remove the won filter"/"any status" clears. No prior state or a brand-new entity+item → fresh query.
4. **`AssistantRepository.find(state)`** (Prisma; never model-written SQL):
   - Always `businessId` in the base clause; BOQ items only via `boq.isCurrent = true`.
   - Item terms → OR of ILIKE on `BoqItem.description|normalizedName` (tenders), `RfqItem`/`PurchaseOrderItem`/`BillItem.description`.
   - **"Quoted"** = tender has a `TENDER_STATUS_CHANGED` audit row `to=SUBMITTED` or a `QUOTATION` attachment; `quotedAt` = earliest of the two per tender, filtered by range. Won/lost = `status` filter (`statusChangedAt` already holds the moment of the current status).
   - RFQ/PO/Bill: `createdAt`/`billDate` (or `deadline` → `dueDate`/`expectedDeliveryDate`).
   - Entity unspecified → search all entity types the caller may read.
   - Per-entity permission check (`tenders:read`, `rfq:read`, `purchase_orders:read`, `bills:read`, `projects:read`); endpoint stays gated by `reports:read`.
5. **Response**: deterministic reply text (no LLM narration → no hallucination, one LLM call/turn), `results` (`SearchResultItemDto`, extended with `RFQ|PurchaseOrder|Bill`, capped at 25 + `total`), `filters` chips, and the merged `state` for the client to echo next turn. Existing behaviour preserved: no structured signal (e.g. "find the bill for TND-2026-001") → old global-search path.

Web: the widget stores `state`, sends `{message, state}`, renders removable filter chips (removing one re-runs with `{state}` only — no LLM), a "New chat" button, and result rows with status/date subtitles.

## Files
- New: `apps/server/src/modules/assistant/{assistant.query.ts (types+zod state), assistant.dates.ts, assistant.parser.ts, assistant.terms.ts, assistant.merge.ts, assistant.repository.ts}` + specs in `__tests__/`.
- Modify: `assistant.service.ts/controller/validation/module.ts`, `infra/llm/ollama.client.ts` (optional JSON-schema `format` + `AbortSignal.timeout`, backward compatible), `shared/middleware/requirePermission.middleware.ts` (export a `roleHasPermission` helper), `packages/types/src/{assistant,report}.ts`, `apps/web/src/components/assistant/assistant-widget.tsx`, `hooks/use-assistant.ts`, `components/search/search-result-list.tsx` + `topbar-search.tsx` (icons for new types), `apps/server/package.json` (+`chrono-node`).
- Reuse: `ollama.client.ts#generateJson`, `SearchResultList`, `createIntegrationTestUser`, existing assistant spec mocking pattern.

## Verification
- Unit: date resolver (fixed clock, IST edges), singularize, parser cases, merge (refine/replace/clear/entity change), terms (LLM valid/invalid/unavailable → fallback), repository where-clauses, permission filtering.
- Integration (supertest, real Postgres, mocked Ollama): seed two businesses with tenders/BOQ versions (old non-current item, current item), SUBMITTED audit rows and a QUOTATION attachment; run turn 1 "tenders I quoted last month for washers" → turn 2 "the ones which I won" (state echoed); assert isolation, `isCurrent` only, refine result set, hrefs.
- `pnpm typecheck`, `pnpm lint`, server + web unit tests; manual live check against the running app and local Ollama.
