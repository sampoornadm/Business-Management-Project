import { BadRequestError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import type { IBusinessesRepository } from "../businesses/businesses.repository.js";
import { parseDeliveryDaysFromNotes } from "../tenders/tender-delivery-days.parser.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { consignmentWeight, joinHsnCodes, splitGst } from "./bid-calculations.js";
import type { BidPayload, ItemPriceRow, ResolvedAnswer } from "./portal-bid.types.js";
import { SAIL_ISP_QUESTIONS } from "./sail-isp.questions.js";

export interface IPortalProfileRepository {
  findAnswers(businessId: string, portalCode: string): Promise<Record<string, string>>;
  saveAnswers(businessId: string, portalCode: string, answers: Record<string, string>): Promise<void>;
}

interface BidPayloadDeps {
  tenders: Pick<ITendersRepository, "findById">;
  boqs: Pick<IBoqRepository, "findCurrentBoq" | "findItemsByBoqId">;
  businesses: Pick<IBusinessesRepository, "findById">;
  portalProfiles: IPortalProfileRepository;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class BidPayloadService {
  constructor(private readonly deps: BidPayloadDeps) {}

  async buildPayload(
    tenderId: string,
    businessId: string,
    portalCode: "SAIL_ISP",
    options: { includeItems?: boolean } = {},
  ): Promise<BidPayload> {
    const includeItems = options.includeItems ?? true;
    const { tenders, boqs, businesses, portalProfiles } = this.deps;
    const tender = await tenders.findById(tenderId, businessId);
    if (!tender) throw new NotFoundError("Tender not found");
    const boq = await boqs.findCurrentBoq(tenderId, businessId);
    if (!boq && includeItems) throw new NotFoundError("Tender has no current BOQ");
    const business = await businesses.findById(businessId);
    if (!business) throw new NotFoundError("Business not found");

    const profile = await portalProfiles.findAnswers(businessId, portalCode);
    const supplierGstin = business.gstNumber;
    const billingGstin = profile.billingGstin;
    // The GST split only matters for item prices; a questions-only run does not need it.
    if (includeItems && !supplierGstin) {
      throw new BadRequestError("Business has no GSTIN, so the GST split cannot be decided");
    }
    if (includeItems && !billingGstin) {
      throw new BadRequestError("Billing-party GSTIN is missing from the portal profile");
    }

    const warnings: string[] = [];
    if (!boq) warnings.push("Tender has no current BOQ: HSN and consignment weight are left untouched");
    const boqItems = boq ? await boqs.findItemsByBoqId(boq.id) : [];
    // Section rows that only group other items carry no price of their own.
    const parentIds = new Set(boqItems.map((i) => i.parentId).filter((id): id is string => id !== null));
    const priceable = boqItems.filter((i) => !parentIds.has(i.id));

    const items: ItemPriceRow[] = [];
    for (const i of includeItems ? priceable : []) {
      if (!i.itemCode || i.rate === null || i.quantity === null) {
        warnings.push(`Item "${i.itemCode ?? i.description}" left out: it needs an item code, quantity and rate`);
        continue;
      }
      items.push({
        itemCode: i.itemCode,
        description: i.description,
        quantity: i.quantity,
        rate: i.rate,
        ...splitGst(i.gstRate, supplierGstin!, billingGstin!),
      });
    }

    const hsn = joinHsnCodes(priceable);
    if (!hsn) warnings.push("No HSN code on any BOQ item: the HSN question is left untouched");
    else {
      for (const i of priceable.filter((candidate) => !candidate.hsnCode?.trim())) {
        warnings.push(`Item "${i.itemCode ?? i.description}" has no HSN code, so it is missing from the HSN list`);
      }
    }
    const weight = consignmentWeight(priceable);
    if (weight.text === null) {
      warnings.push(`Consignment weight not filled: ${weight.missing} item(s) have no unit weight`);
    }
    const tenderDays = parseDeliveryDaysFromNotes(tender.notes);
    if (tenderDays !== null && tenderDays < tender.deliveryPeriodDays) {
      warnings.push(`Delivery: tender asks ${tenderDays} days, we offer ${tender.deliveryPeriodDays}`);
    }

    const contact = business.contacts.find((c) => c.isPrimary) ?? business.contacts[0];
    const cityPin = business.city && business.pincode ? `${business.city} - ${business.pincode}` : business.city ?? business.pincode;
    const businessValues: Record<string, string | null | undefined> = {
      supplierGstin: supplierGstin ?? undefined,
      panNumber: business.panNumber,
      udyamNumber: business.udyamRegistrationNumber,
      email: contact?.email,
      phone: contact?.phone,
      mobile: contact?.phone,
      address: [business.address, cityPin].filter(Boolean).join(", ") || null,
      contactPerson: contact?.name,
    };
    const tenderValues: Record<string, string | null | undefined> = {
      hsnCode: hsn,
      consignmentWeight: weight.text,
      deliveryPeriodDays: String(tender.deliveryPeriodDays),
    };

    const answers: ResolvedAnswer[] = [];
    for (const spec of SAIL_ISP_QUESTIONS) {
      const derived =
        spec.source === "business" ? businessValues[spec.key] : spec.source === "tender" ? tenderValues[spec.key] : undefined;
      // A tender-derived value never falls back to the profile: a stale answer from an earlier
      // bid (another tender's weight or HSN) would be typed in as if it were this tender's.
      const fromProfile = spec.source === "tender" ? undefined : profile[spec.key];
      const value = derived || fromProfile;
      if (!value) {
        if (spec.source !== "tender") warnings.push(`No answer on file for "${spec.label}"`);
        continue;
      }
      const comment = spec.hasComment ? profile[`${spec.key}.comment`] : undefined;
      answers.push({
        key: spec.key,
        label: spec.label,
        widget: spec.widget,
        value,
        source: derived ? spec.source : "profile",
        ...(comment ? { comment } : {}),
      });
    }

    return {
      tenderNumber: tender.tenderNumber,
      answers,
      items,
      expectedTotal: round2(items.reduce((sum, i) => sum + i.quantity * i.rate, 0)),
      warnings,
    };
  }
}
