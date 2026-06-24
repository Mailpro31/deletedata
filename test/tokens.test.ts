import { describe, it, expect } from "vitest";
import { buildTokenMap, resolveValue } from "../src/forms/tokens";
import type { IdentityData } from "../src/domain/types";

const identity: IdentityData = {
  fullNames: ["Jean Dupont", "J. Dupont"],
  emails: ["jean@gmail.com"],
  addresses: ["1 rue Test, Paris"],
  phones: ["0600000000"],
};

describe("jetons de formulaire", () => {
  it("buildTokenMap décompose le nom et privilégie l'alias pour $email", () => {
    const t = buildTokenMap(identity, "jean+spokeo@gmail.com");
    expect(t.$fullName).toBe("Jean Dupont");
    expect(t.$firstName).toBe("Jean");
    expect(t.$lastName).toBe("Dupont");
    expect(t.$email).toBe("jean+spokeo@gmail.com"); // alias traçable
    expect(t.$primaryEmail).toBe("jean@gmail.com");
    expect(t.$address).toBe("1 rue Test, Paris");
  });

  it("$email retombe sur l'email principal sans alias", () => {
    expect(buildTokenMap(identity).$email).toBe("jean@gmail.com");
  });

  it("resolveValue substitue les jetons connus et laisse le reste", () => {
    const t = buildTokenMap(identity, "jean+x@gmail.com");
    expect(resolveValue("$firstName $lastName", t)).toBe("Jean Dupont");
    expect(resolveValue("contact: $email", t)).toBe("contact: jean+x@gmail.com");
    expect(resolveValue("$inconnu reste", t)).toBe("$inconnu reste");
  });
});
