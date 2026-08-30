import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isValidTeacherEmail,
  isValidTeacherName,
  normalizeTeacherPhone,
} from "@/lib/account-request-input";

describe("normalizeTeacherPhone", () => {
  it("accepts dashed and plain 010 numbers", () => {
    assert.equal(normalizeTeacherPhone("010-1234-5678"), "010-1234-5678");
    assert.equal(normalizeTeacherPhone("01012345678"), "010-1234-5678");
    assert.equal(normalizeTeacherPhone("010 1234 5678"), "010-1234-5678");
  });

  it("rejects non-mobile numbers", () => {
    assert.equal(normalizeTeacherPhone("02-123-4567"), null);
    assert.equal(normalizeTeacherPhone("011-1234-5678"), null);
    assert.equal(normalizeTeacherPhone("010-123-5678"), null);
  });
});

describe("teacher field validation", () => {
  it("requires a two-character name", () => {
    assert.equal(isValidTeacherName("홍길동"), true);
    assert.equal(isValidTeacherName("김"), false);
    assert.equal(isValidTeacherName("  "), false);
  });

  it("checks email shape", () => {
    assert.equal(isValidTeacherEmail("a@b.co"), true);
    assert.equal(isValidTeacherEmail("not-an-email"), false);
  });
});
