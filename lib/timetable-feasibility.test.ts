import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkPlacementFeasibility,
  explainUnplaced,
} from "@/lib/timetable-feasibility";
import { createDefaultGenerationPreferences } from "@/lib/generation-preferences";
import { generateTimetableV2 } from "@/lib/timetable-improved";
import {
  createEmptyTeacherAssignments,
  type GradeDaySchedules,
  type GradeSubjects,
  type Teacher,
  type TeacherForbiddenSlot,
  type WeekdayPeriods,
} from "@/lib/types";

function schedulesOf(p: WeekdayPeriods): GradeDaySchedules {
  return { 1: { ...p }, 2: { ...p }, 3: { ...p } };
}

function commonSubjects(names: string[]): GradeSubjects {
  return {
    1: names.map((name) => ({ set: "공통", name, units: 4, classCount: 1 })),
    2: [],
    3: [],
  };
}

function teacher(name: string, subjectName: string, classHours: number[]): Teacher {
  const assignments = createEmptyTeacherAssignments();
  assignments[1] = [
    {
      name: subjectName,
      hours: classHours.reduce((a, b) => a + b, 0),
      classHours,
    },
  ];
  return { name, assignments };
}

const base = {
  subjects: commonSubjects(["국어", "수학"]),
  classCounts: { 1: 2, 2: 0, 3: 0 },
  // 하루 2교시 × 5일 = 반마다 10칸
  schedules: schedulesOf({ mon: 2, tue: 2, wed: 2, thu: 2, fri: 2 }),
  wholeCells: [],
  partialCells: [],
};

describe("checkPlacementFeasibility", () => {
  it("reports zero when every lesson has room", () => {
    const report = checkPlacementFeasibility({
      ...base,
      teachers: [teacher("김", "국어", [5, 5]), teacher("이", "수학", [5, 5])],
    });
    assert.equal(report.minUnplaced, 0);
    assert.equal(report.lessonCount, 20);
  });

  it("finds the teacher-side shortfall caused by 배정 불가", () => {
    // 김 교사는 두 반 합쳐 10시간인데, 배정 불가로 월요일 2교시만 남는다.
    const forbiddenSlots: TeacherForbiddenSlot[] = [];
    for (const day of ["tue", "wed", "thu", "fri"] as const) {
      for (const period of [1, 2]) {
        forbiddenSlots.push({ teacherName: "김", day, period });
      }
    }
    const report = checkPlacementFeasibility({
      ...base,
      teachers: [teacher("김", "국어", [5, 5]), teacher("이", "수학", [5, 5])],
      forbiddenSlots,
    });
    assert.equal(report.teacherShortfall, 8);
    assert.equal(report.minUnplaced, 8);
    assert.deepEqual(
      report.teachers.map((t) => t.label),
      ["김"],
    );
  });

  it("finds the class-side shortfall when a class has more lessons than slots", () => {
    const report = checkPlacementFeasibility({
      ...base,
      teachers: [teacher("김", "국어", [6, 5]), teacher("이", "수학", [6, 5])],
    });
    assert.equal(report.classShortfall, 2);
    assert.equal(report.classes[0].label, "1학년 1반");
  });

  const tueWedOff: TeacherForbiddenSlot[] = [
    { teacherName: "김", day: "tue", period: 1 },
    { teacherName: "김", day: "tue", period: 2 },
    { teacherName: "김", day: "wed", period: 1 },
    { teacherName: "김", day: "wed", period: 2 },
  ];
  const runV2 = (input: Parameters<typeof checkPlacementFeasibility>[0]) => {
    const result = generateTimetableV2({
      ...input,
      subjectBlocks: [],
      pinnedSubjectBlocks: [],
      preferences: createDefaultGenerationPreferences(),
      timeLimitMs: 2000,
    });
    return result.unplaced.reduce((sum, u) => sum + u.remaining, 0);
  };

  it("v2 fills everything when the check passes", () => {
    // 김: 6시간 / 남은 6칸, 이: 10시간 / 10칸, 반마다 8시간 / 10칸
    const input = {
      ...base,
      teachers: [teacher("김", "국어", [3, 3]), teacher("이", "수학", [5, 5])],
      forbiddenSlots: tueWedOff,
    };
    assert.equal(checkPlacementFeasibility(input).minUnplaced, 0);
    assert.equal(runV2(input), 0);
  });

  it("v2 never leaves fewer lessons unplaced than the lower bound", () => {
    // 김: 8시간 / 남은 6칸(부족 2), 이: 12시간 / 10칸(부족 2)
    const input = {
      ...base,
      teachers: [teacher("김", "국어", [4, 4]), teacher("이", "수학", [6, 6])],
      forbiddenSlots: tueWedOff,
    };
    const report = checkPlacementFeasibility(input);
    assert.equal(report.minUnplaced, 4);
    assert.ok(runV2(input) >= report.minUnplaced);
  });
});

describe("placement count estimate", () => {
  it("brackets the exact count for one class", () => {
    // 1개 반, 4칸, 국어 2시간 + 수학 2시간 → 정확히 4!/(2!·2!) = 6가지
    const report = checkPlacementFeasibility({
      ...base,
      classCounts: { 1: 1, 2: 0, 3: 0 },
      schedules: schedulesOf({ mon: 2, tue: 2, wed: 0, thu: 0, fri: 0 }),
      teachers: [teacher("김", "국어", [2]), teacher("이", "수학", [2])],
    });
    const exact = Math.log10(6);
    assert.ok(report.estimate);
    assert.ok(report.estimate.log10Upper >= exact - 1e-9);
    assert.ok(report.estimate.log10ClassLower <= exact + 1e-9);
    // 반이 하나라 교사 겹침이 없다.
    assert.equal(report.estimate.log10NoClash, 0);
  });

  it("is omitted when some lessons can never be placed", () => {
    const report = checkPlacementFeasibility({
      ...base,
      teachers: [teacher("김", "국어", [6, 5]), teacher("이", "수학", [6, 5])],
    });
    assert.equal(report.estimate, null);
  });
});

describe("explainUnplaced", () => {
  const report = (minUnplaced: number) => ({
    minUnplaced,
    classShortfall: minUnplaced,
    teacherShortfall: 0,
    classes: [],
    teachers: [],
    lessonCount: 0,
    estimate: null,
    elapsedMs: 0,
  });

  it("separates unavoidable and retryable lessons", () => {
    assert.match(explainUnplaced(3, report(3)), /피할 수 없습니다/);
    assert.match(explainUnplaced(5, report(2)), /최소 2교시.*나머지 3교시/);
    assert.match(explainUnplaced(2, report(0)), /다시 시도하면/);
    assert.equal(explainUnplaced(0, report(0)), "");
  });
});
