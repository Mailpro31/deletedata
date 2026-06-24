import { describe, it, expect } from "vitest";
import {
  inferChannel,
  inferJurisdiction,
  inferPublicSearch,
  inferVerification,
  normalizeBroker,
} from "../src/brokers/import/normalize";
import type { RawBroker } from "../src/brokers/import/types";

const raw = (p: Partial<RawBroker>): RawBroker => ({
  slug: "x",
  name: "X",
  source: "test",
  sourceLicense: "MIT",
  ...p,
});

describe("heuristiques d'import", () => {
  it("email sans URL => canal email", () => {
    expect(inferChannel(raw({ email: "privacy@x.com" }))).toBe("email");
  });
  it("URL d'opt-out => canal form", () => {
    expect(inferChannel(raw({ optOutUrl: "https://x.com/optout" }))).toBe("form");
  });
  it("pièce d'identité requise => manual", () => {
    expect(inferChannel(raw({ optOutUrl: "https://x.com", requiresIdentityDoc: true }))).toBe(
      "manual",
    );
  });
  it("background-check => manual", () => {
    expect(inferChannel(raw({ optOutUrl: "https://x.com", category: "background-check" }))).toBe(
      "manual",
    );
  });

  it("juridiction depuis region", () => {
    expect(inferJurisdiction("eu")).toBe("eu");
    expect(inferJurisdiction("USA")).toBe("us");
    expect(inferJurisdiction(undefined)).toBe("global");
  });

  it("recherche publique selon catégorie", () => {
    expect(inferPublicSearch("people-search")).toBe(true);
    expect(inferPublicSearch("background-check")).toBe(false);
  });

  it("vérification: email->email, public->rescan, sinon none", () => {
    expect(inferVerification("email", false, raw({}))).toBe("email");
    expect(inferVerification("form", true, raw({}))).toBe("rescan");
    expect(inferVerification("form", false, raw({}))).toBe("none");
    expect(inferVerification("manual", true, raw({ requiresIdentityDoc: true }))).toBe("none");
  });

  it("normalizeBroker n'active jamais et déduit le domaine email", () => {
    const b = normalizeBroker(raw({ email: "privacy@Criteo.com", region: "eu" }));
    expect(b.active).toBe(false);
    expect(b.channel).toBe("email");
    expect(b.emailDomain).toBe("criteo.com");
    expect(b.jurisdiction).toBe("eu");
  });
});
