import { beforeEach, describe, expect, it } from "vitest";

import { BadRequestError } from "../../../core/errors/HttpErrors.js";
import type { IPortalProfileRepository } from "../bid-payload.service.js";
import { PortalProfileService } from "../portal-profile.service.js";

class FakeProfiles implements IPortalProfileRepository {
  answers: Record<string, string> = {};
  async findAnswers() {
    return { ...this.answers };
  }
  async saveAnswers(_b: string, _p: string, answers: Record<string, string>) {
    this.answers = answers;
  }
}

describe("PortalProfileService", () => {
  let profiles: FakeProfiles;
  const logged: Array<Record<string, unknown>> = [];

  const service = () =>
    new PortalProfileService({
      businesses: {
        findById: async () =>
          ({ id: "b1", name: "Samson", gstNumber: "19ABCDE1234F1Z5", panNumber: "ABCDE1234F", contacts: [] }) as never,
      },
      portalProfiles: profiles,
      audit: { log: async (entry) => void logged.push(entry as never) },
    });

  beforeEach(() => {
    profiles = new FakeProfiles();
    logged.length = 0;
  });

  it("lists every question, taking business-sourced values from the Business record", async () => {
    profiles.answers = { billingGstin: "19AAACS7062F6Z6", panNumber: "STALE0000X" };
    const profile = await service().get("b1");
    const byKey = Object.fromEntries(profile.questions.map((q) => [q.key, q]));
    expect(byKey.billingGstin).toMatchObject({ value: "19AAACS7062F6Z6", editable: true, source: "profile" });
    expect(byKey.panNumber).toMatchObject({ value: "ABCDE1234F", editable: false, source: "business" });
    expect(byKey.hsnCode).toMatchObject({ value: "", editable: false, source: "tender" });
    expect(profile.questions.length).toBeGreaterThan(40);
  });

  it("saves edits, clears an answer given as empty text, and audits only the keys", async () => {
    profiles.answers = { billingState: "West Bengal", billingGstin: "OLD" };
    await service().update("b1", "u1", { billingGstin: " 19AAACS7062F6Z6 ", billingState: "  " });
    expect(profiles.answers).toEqual({ billingGstin: "19AAACS7062F6Z6" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "PORTAL_PROFILE_UPDATED", actorId: "u1", metadata: { keys: ["billingGstin", "billingState"] } });
  });

  it("refuses to store an answer that comes from the Business record or the tender", async () => {
    await expect(service().update("b1", "u1", { panNumber: "X" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service().update("b1", "u1", { hsnCode: "7317" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service().update("b1", "u1", { nonsense: "1" })).rejects.toBeInstanceOf(BadRequestError);
    expect(profiles.answers).toEqual({});
  });
});
