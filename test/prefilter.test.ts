import { describe, it, expect } from "vitest";
import { prefilter } from "../src/verify/classify/prefilter";

describe("prefilter (prudent)", () => {
  it("classe les auto-réponses en unrelated", () => {
    expect(prefilter("Out of office", "I am away")).toBe("unrelated");
    expect(prefilter("Réponse automatique", "absence du bureau")).toBe("unrelated");
  });

  it("classe les échecs de remise en unrelated", () => {
    expect(prefilter("Mail delivery failed", "undeliverable")).toBe("unrelated");
  });

  it("NE pré-confirme JAMAIS une suppression : 'we will delete' -> null (laissé au LLM)", () => {
    expect(prefilter("Re: your request", "We will delete your data soon.")).toBeNull();
  });

  it("NE pré-confirme pas non plus 'we have deleted' (sens laissé au LLM)", () => {
    expect(prefilter("Re: your request", "We have deleted your data.")).toBeNull();
  });
});
