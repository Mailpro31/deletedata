import { describe, it, expect } from "vitest";
import { attach, type Candidate } from "../src/verify/imap/attach";
import type { ParsedMessage } from "../src/verify/imap/fetchIncremental";
import type { RequestRow } from "../src/db/schema";

const req = (p: Partial<RequestRow>): RequestRow =>
  ({ id: 1, brokerId: 1, ...p }) as unknown as RequestRow;

const msg = (p: Partial<ParsedMessage>): ParsedMessage => ({
  uid: 1,
  to: [],
  subject: "",
  references: [],
  ...p,
});

describe("attach — rattachement par priorité", () => {
  it("1) plus-address : alias dans le To", () => {
    const cands: Candidate[] = [
      { request: req({ id: 10, plusAlias: "me+spokeo@gmail.com" }), brokerSlug: "spokeo", emailDomain: "spokeo.com" },
    ];
    const m = attach(msg({ to: ["me+spokeo@gmail.com"], from: "noreply@unknown.com" }), cands);
    expect(m?.method).toBe("plus-address");
    expect(m?.request.id).toBe(10);
  });

  it("2) domaine expéditeur", () => {
    const cands: Candidate[] = [
      { request: req({ id: 20, sentAt: new Date() }), brokerSlug: "criteo", emailDomain: "criteo.com" },
    ];
    const m = attach(msg({ to: ["me@gmail.com"], from: "dpo@criteo.com" }), cands);
    expect(m?.method).toBe("sender-domain");
    expect(m?.request.id).toBe(20);
  });

  it("3) threading via In-Reply-To", () => {
    const cands: Candidate[] = [
      { request: req({ id: 30, messageId: "<abc@me.local>" }), brokerSlug: "x", emailDomain: null },
    ];
    const m = attach(msg({ to: ["me@gmail.com"], from: "x@y.com", inReplyTo: "<abc@me.local>" }), cands);
    expect(m?.method).toBe("threading");
    expect(m?.request.id).toBe(30);
  });

  it("plus-address prioritaire sur le domaine", () => {
    const cands: Candidate[] = [
      { request: req({ id: 40, plusAlias: "me+spokeo@gmail.com" }), brokerSlug: "spokeo", emailDomain: "spokeo.com" },
      { request: req({ id: 41, sentAt: new Date() }), brokerSlug: "other", emailDomain: "spokeo.com" },
    ];
    const m = attach(msg({ to: ["me+spokeo@gmail.com"], from: "x@spokeo.com" }), cands);
    expect(m?.method).toBe("plus-address");
    expect(m?.request.id).toBe(40);
  });

  it("aucune correspondance => null", () => {
    const cands: Candidate[] = [
      { request: req({ id: 50, plusAlias: "me+a@gmail.com", messageId: "<z@me>" }), brokerSlug: "a", emailDomain: "a.com" },
    ];
    expect(attach(msg({ to: ["me@gmail.com"], from: "n@b.com" }), cands)).toBeNull();
  });
});
