import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultGenerationPreferences } from "@/lib/generation-preferences";
import {
  checkExactPlacement,
  isPlacementBlocked,
  runPlacementCheck,
} from "@/lib/timetable-exact-check";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import {
  createEmptyTeacherAssignments,
  type GradeDaySchedules,
  type GradeSubjects,
  type Teacher,
  type TeacherForbiddenSlot,
  type WeekdayPeriods,
} from "@/lib/types";
import { DEFAULT_V2_WEIGHTS, normalizeV2Weights, parseV2Weights } from "@/lib/v2-weights";

function schedulesOf(p: WeekdayPeriods): GradeDaySchedules {
  return { 1: { ...p }, 2: { ...p }, 3: { ...p } };
}

function teacher(name: string, subjectName: string, classHours: number[]): Teacher {
  const assignments = createEmptyTeacherAssignments();
  assignments[1] = [
    { name: subjectName, hours: classHours.reduce((a, b) => a + b, 0), classHours },
  ];
  return { name, assignments };
}

const subjects: GradeSubjects = {
  1: ["국어", "수학", "영어"].map((name) => ({ set: "공통" as const, name, units: 4, classCount: 1 })),
    2: [],
    3: [],
};

const base = {
  subjects,
  classCounts: { 1: 2, 2: 0, 3: 0 },
  // 반마다 하루 2교시 × 3일 = 6칸
  schedules: schedulesOf({ mon: 2, tue: 2, wed: 2, thu: 0, fri: 0 }),
  wholeCells: [],
  partialCells: [],
};

describe("checkExactPlacement", () => {
  it("proves feasibility and returns a complete placement", async () => {
    const input = {
      ...base,
      teachers: [
        teacher("김", "국어", [2, 2]),
        teacher("이", "수학", [2, 2]),
        teacher("박", "영어", [2, 2]),
      ],
    };
    const result = await checkExactPlacement(input);
    assert.equal(result.status, "feasible");
    assert.equal(result.minUnplaced, 0);
    assert.equal(result.solutionCells.length, 12);
    // 교사 겹침이 없어야 한다.
    const times = new Set(result.solutionCells.map((c) => `${c.teacherName}|${c.day}|${c.period}`));
    assert.equal(times.size, 12);
  });

  it("finds clashes the per-class / per-teacher matching misses", async () => {
    // 반 2개 × (월·화 2교시) = 반마다 4칸, 수업도 반마다 4시간이라 꽉 찬다.
    // 월 2교시에 김·박이 배정 불가라 그 칸에는 두 반 모두 이 교사만 올 수
    // 있다 → 이 교사가 두 반에 동시에 필요해 1시간은 반드시 남는다.
    // 반 기준·교사 기준 매칭은 각각 통과하므로 빠른 검사로는 못 잡는다.
    const forbiddenSlots: TeacherForbiddenSlot[] = [
      { teacherName: "김", day: "mon", period: 2 },
      { teacherName: "박", day: "mon", period: 2 },
    ];
    const input = {
      ...base,
      schedules: schedulesOf({ mon: 2, tue: 2, wed: 0, thu: 0, fri: 0 }),
      teachers: [
        teacher("김", "국어", [1, 1]),
        teacher("이", "수학", [1, 2]),
        teacher("박", "영어", [2, 1]),
      ],
      forbiddenSlots,
    };
    const { report } = await runPlacementCheck(input);
    assert.equal(report.minUnplaced, 0, "matching bound alone passes");
    assert.equal(report.exact.status, "infeasible");
    assert.equal(report.exact.minUnplaced, 1);
    assert.equal(isPlacementBlocked(report), true);
  });

  it("v2 starting from the exact placement leaves nothing unplaced", async () => {
    const input = {
      ...base,
      teachers: [
        teacher("김", "국어", [2, 2]),
        teacher("이", "수학", [2, 2]),
        teacher("박", "영어", [2, 2]),
      ],
    };
    const { solutionCells } = await runPlacementCheck(input);
    const result = generateTimetableV2({
      ...input,
      subjectBlocks: [],
      pinnedSubjectBlocks: [],
      preferences: createDefaultGenerationPreferences(),
      timeLimitMs: 1500,
      v2: { initialCommonCells: solutionCells },
    });
    assert.equal(result.status, "ready");
    assert.equal(result.unplaced.length, 0);
  });
});

describe("v2 weights", () => {
  it("accepts only the offered levels", () => {
    assert.deepEqual(parseV2Weights({ lunch: 10, triple: 1, sameDay: 5 }), {
      lunch: 10,
      triple: 1,
      sameDay: 5,
    });
    assert.equal(parseV2Weights({ lunch: 4, triple: 1, sameDay: 5 }), null);
    assert.deepEqual(normalizeV2Weights(undefined), DEFAULT_V2_WEIGHTS);
  });
});

describe("placement check cache key", () => {
  const input = {
    ...base,
    teachers: [
      teacher("김", "국어", [2, 2]),
      teacher("이", "수학", [2, 2]),
      teacher("박", "영어", [2, 2]),
    ],
  };

  it("is stable for the same conditions and changes when they change", async () => {
    const { placementInputKey } = await import("@/lib/timetable-check-cache");
    assert.equal(placementInputKey(input), placementInputKey({ ...input }));
    const withForbidden = {
      ...input,
      forbiddenSlots: [{ teacherName: "김", day: "mon" as const, period: 1 }],
    };
    assert.notEqual(placementInputKey(input), placementInputKey(withForbidden));
  });

  it("v2 says so when it stops because nothing is left to improve", async () => {
    const { solutionCells } = await runPlacementCheck(input);
    const result = generateTimetableV2({
      ...input,
      subjectBlocks: [],
      pinnedSubjectBlocks: [],
      // 선호 조건을 모두 끄면 점수 0에서 바로 끝난다.
      preferences: {
        ...createDefaultGenerationPreferences(),
        avoidLunchDouble: false,
        avoidTriplePeriod: false,
      },
      timeLimitMs: 5000,
      v2: { initialCommonCells: solutionCells },
    });
    assert.match(result.message, /위반 0건/);
  });
});
