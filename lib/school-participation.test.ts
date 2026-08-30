import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPLY_SOCIAL_PROOF_LOW,
  APPLY_SOCIAL_PROOF_MID,
  countUniqueParticipatingSchools,
  getApplySocialProofMessage,
} from "@/lib/school-participation";

describe("getApplySocialProofMessage", () => {
  it("hides the count below 10", () => {
    assert.equal(getApplySocialProofMessage(0), APPLY_SOCIAL_PROOF_LOW);
    assert.equal(getApplySocialProofMessage(9), APPLY_SOCIAL_PROOF_LOW);
  });

  it("uses a numberless line from 10 through 29", () => {
    assert.equal(getApplySocialProofMessage(10), APPLY_SOCIAL_PROOF_MID);
    assert.equal(getApplySocialProofMessage(29), APPLY_SOCIAL_PROOF_MID);
    assert.equal(getApplySocialProofMessage(10).includes("10"), false);
  });

  it("shows the count from 30", () => {
    assert.equal(
      getApplySocialProofMessage(30),
      "현재 30개 학교에서 이용 중입니다.",
    );
    assert.equal(
      getApplySocialProofMessage(42),
      "현재 42개 학교에서 이용 중입니다.",
    );
  });
});

describe("countUniqueParticipatingSchools", () => {
  it("returns 0 when empty", () => {
    assert.equal(countUniqueParticipatingSchools([], []), 0);
  });

  it("counts an account without a matching request", () => {
    assert.equal(
      countUniqueParticipatingSchools([{ username: "가락고등학교" }], []),
      1,
    );
  });

  it("counts a request without a matching account", () => {
    assert.equal(
      countUniqueParticipatingSchools(
        [],
        [
          {
            schoolName: "가락고등학교",
            sido: "서울특별시",
            schoolCode: "7010057",
            atptCode: "B10",
          },
        ],
      ),
      1,
    );
  });

  it("merges an account with a request of the same school name", () => {
    assert.equal(
      countUniqueParticipatingSchools(
        [{ username: "가락고등학교" }],
        [
          {
            schoolName: "가락고등학교",
            sido: "서울특별시",
            schoolCode: "7010057",
            atptCode: "B10",
          },
        ],
      ),
      1,
    );
  });

  it("counts distinct school names separately", () => {
    assert.equal(
      countUniqueParticipatingSchools(
        [{ username: "가락고등학교" }],
        [
          {
            schoolName: "언양고등학교",
            sido: "울산광역시",
            schoolCode: "1",
            atptCode: "A",
          },
        ],
      ),
      2,
    );
  });

  it("does not double-count the same account username", () => {
    assert.equal(
      countUniqueParticipatingSchools(
        [{ username: "가락고등학교" }, { username: "가락고등학교" }],
        [],
      ),
      1,
    );
  });

  it("treats same-name schools in different regions as two when only requests exist", () => {
    assert.equal(
      countUniqueParticipatingSchools(
        [],
        [
          { schoolName: "강남중학교", sido: "서울특별시" },
          { schoolName: "강남중학교", sido: "부산광역시" },
        ],
      ),
      2,
    );
  });
});
