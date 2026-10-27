import type { PortalProfileDto, PortalProfileQuestionDto } from "@bmp/types";

import { BadRequestError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { IBusinessesRepository } from "../businesses/businesses.repository.js";

import { businessAnswerValues, type IPortalProfileRepository } from "./bid-payload.service.js";
import { SAIL_ISP_QUESTIONS } from "./sail-isp.questions.js";

const PORTAL_CODE = "SAIL_ISP";
const COMMENT_SUFFIX = ".comment";

interface PortalProfileDeps {
  businesses: Pick<IBusinessesRepository, "findById">;
  portalProfiles: IPortalProfileRepository;
  audit: Pick<AuditService, "log">;
}

export class PortalProfileService {
  constructor(private readonly deps: PortalProfileDeps) {}

  /** Every catalog question with the value the portal would be given, for the profile editor. */
  async get(businessId: string): Promise<PortalProfileDto> {
    const business = await this.deps.businesses.findById(businessId);
    if (!business) throw new NotFoundError("Business not found");
    const stored = await this.deps.portalProfiles.findAnswers(businessId, PORTAL_CODE);
    const fromBusiness = businessAnswerValues(business, stored);

    const questions: PortalProfileQuestionDto[] = SAIL_ISP_QUESTIONS.map((spec) => ({
      key: spec.key,
      label: spec.label,
      widget: spec.widget,
      source: spec.source,
      // Same precedence as the fill: the Business record wins for its own fields, and a
      // tender-derived answer never comes from the profile.
      value:
        spec.source === "tender"
          ? ""
          : (spec.source === "business" ? fromBusiness[spec.key] : undefined) || stored[spec.key] || "",
      editable: spec.source === "profile",
      hasComment: Boolean(spec.hasComment),
      comment: spec.hasComment ? (stored[`${spec.key}${COMMENT_SUFFIX}`] ?? "") : "",
    }));
    return { portalCode: PORTAL_CODE, businessId, businessName: business.name, questions };
  }

  /** Merges edits into the stored answers; an empty string removes that answer. */
  async update(businessId: string, actorId: string, edits: Record<string, string>): Promise<PortalProfileDto> {
    const editable = new Set<string>();
    for (const spec of SAIL_ISP_QUESTIONS) {
      if (spec.source !== "profile") continue;
      editable.add(spec.key);
      if (spec.hasComment) editable.add(`${spec.key}${COMMENT_SUFFIX}`);
    }
    const rejected = Object.keys(edits).filter((key) => !editable.has(key));
    if (rejected.length > 0) {
      throw new BadRequestError(`These answers cannot be edited in the profile: ${rejected.join(", ")}`);
    }

    const next = { ...(await this.deps.portalProfiles.findAnswers(businessId, PORTAL_CODE)) };
    for (const [key, value] of Object.entries(edits)) {
      const text = value.trim();
      if (text) next[key] = text;
      else delete next[key];
    }
    await this.deps.portalProfiles.saveAnswers(businessId, PORTAL_CODE, next);
    await this.deps.audit.log({
      actorId,
      action: "PORTAL_PROFILE_UPDATED",
      entityType: "Business",
      entityId: businessId,
      metadata: { portalCode: PORTAL_CODE, keys: Object.keys(edits) },
    });
    return this.get(businessId);
  }
}
