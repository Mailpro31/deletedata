import { describe, it, expect } from "vitest";
import { parseStatus } from "../src/verify/classify/vertex";

describe("parseStatus — parsing JSON robuste de la classification", () => {
  it("JSON strict", () => {
    expect(parseStatus('{"status":"confirmed_deletion"}')).toBe("confirmed_deletion");
  });

  it("extrait un bloc {...} entouré de texte", () => {
    expect(parseStatus('Voici la réponse : {"status":"acknowledged"} — fin')).toBe("acknowledged");
  });

  it("statut inconnu => null (jamais de faux 'confirmé')", () => {
    expect(parseStatus('{"status":"banana"}')).toBeNull();
  });

  it("non-JSON => null", () => {
    expect(parseStatus("désolé je ne peux pas")).toBeNull();
  });

  it("clé absente => null", () => {
    expect(parseStatus('{"foo":1}')).toBeNull();
  });
});
