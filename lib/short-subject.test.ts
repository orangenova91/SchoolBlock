import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shortSubjectName } from "@/lib/subjects";

describe("shortSubjectName", () => {
  it("keeps short names as-is", () => {
    assert.equal(shortSubjectName("체육1"), "체육1");
    assert.equal(shortSubjectName("한국사2"), "한국사2");
  });

  it("keeps the level marker when shortening", () => {
    assert.equal(shortSubjectName("E중국어회화Ⅱ"), "E중국Ⅱ");
    assert.equal(shortSubjectName("공통국어2"), "공통국2");
  });

  it("drops spaces and cuts long names", () => {
    assert.equal(shortSubjectName("디지털과 직업 생활"), "디지털과");
    assert.equal(shortSubjectName("A세계시민과 지리"), "A세계시");
  });
});
