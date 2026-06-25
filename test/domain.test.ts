import { describe, it, expect } from "vitest";
import {
  classificationToOutcome,
  initialConfidenceOnSend,
  isConfirmedDeleted,
  canTransition,
} from "../src/domain/status";

describe("classificationToOutcome — LE garde-fou central", () => {
  it("confirmed_deletion => statut confirmed + confiance confirmed_email", () => {
    const o = classificationToOutcome("confirmed_deletion");
    expect(o.status).toBe("confirmed");
    expect(o.confidenceStatus).toBe("confirmed_email");
  });

  it("acknowledged NE confirme JAMAIS : reste pending (déclenchera une relance)", () => {
    const o = classificationToOutcome("acknowledged");
    expect(o.status).toBe("acknowledged");
    expect(o.confidenceStatus).toBe("pending");
    expect(isConfirmedDeleted(o.confidenceStatus)).toBe(false);
  });

  it("needs_more_info + pièce d'identité => manual_required", () => {
    expect(classificationToOutcome("needs_more_info", true).status).toBe("manual_required");
    expect(classificationToOutcome("needs_more_info", false).status).toBe("needs_info");
  });

  it("refused => refused ; unrelated => noop", () => {
    expect(classificationToOutcome("refused").confidenceStatus).toBe("refused");
    expect(classificationToOutcome("unrelated").noop).toBe(true);
  });
});

describe("initialConfidenceOnSend", () => {
  it("none => unverifiable (tracé honnêtement)", () => {
    expect(initialConfidenceOnSend("none")).toBe("unverifiable");
  });
  it("email/rescan => pending", () => {
    expect(initialConfidenceOnSend("email")).toBe("pending");
    expect(initialConfidenceOnSend("rescan")).toBe("pending");
  });
});

describe("canTransition", () => {
  it("autorise sent -> confirmed mais pas draft -> confirmed", () => {
    expect(canTransition("sent", "confirmed")).toBe(true);
    expect(canTransition("draft", "confirmed")).toBe(false);
  });
  it("confirmed est terminal", () => {
    expect(canTransition("confirmed", "sent")).toBe(false);
  });
});
