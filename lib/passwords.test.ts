import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validatePassword } from "@/lib/passwords";

describe("validatePassword", () => {
  it("accepts 8+ characters without whitespace", () => {
    assert.equal(validatePassword("Abcd1234"), "Abcd1234");
    assert.equal(validatePassword("abcdefgh"), "abcdefgh");
  });

  it("rejects short or spaced values", () => {
    assert.equal(validatePassword("short"), null);
    assert.equal(validatePassword("abcd 234"), null);
    assert.equal(validatePassword(""), null);
    assert.equal(validatePassword(12), null);
  });
});
