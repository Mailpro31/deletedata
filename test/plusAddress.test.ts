import { describe, it, expect } from "vitest";
import {
  buildPlusAlias,
  extractSlugFromPlusAlias,
  baseOfAddress,
} from "../src/send/plusAddress";

describe("plus-addressing", () => {
  it("construit local+slug@domaine", () => {
    expect(buildPlusAlias("me@gmail.com", "spokeo")).toBe("me+spokeo@gmail.com");
  });

  it("remplace un +tag déjà présent", () => {
    expect(buildPlusAlias("me+old@gmail.com", "acxiom")).toBe("me+acxiom@gmail.com");
  });

  it("round-trip slug", () => {
    const alias = buildPlusAlias("me@gmail.com", "been-verified");
    expect(extractSlugFromPlusAlias(alias)).toBe("been-verified");
  });

  it("extractSlug renvoie undefined sans +tag", () => {
    expect(extractSlugFromPlusAlias("me@gmail.com")).toBeUndefined();
  });

  it("baseOfAddress retire le +tag", () => {
    expect(baseOfAddress("me+spokeo@gmail.com")).toBe("me@gmail.com");
  });
});
