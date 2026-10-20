import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listLunchTeacherDoubles, solveLunchPriority } from "@/lib/timetable";
import {
  createEmptyTeacherAssignments,
  type GradeDaySchedules,
  type GradeSubjects,
  type Teacher,
  type WeekdayPeriods,
} from "@/lib/types";

// Only Monday reaches period 5, so the lunch targets are exactly
// 1-1/1-2 × 4교시/5교시 on Monday (lunch after period 4).
function mondayOnly(): GradeDaySchedules {
  const p: WeekdayPeriods = { mon: 5, tue: 4, wed: 4, thu: 4, fri: 4 };
  return { 1: { ...p }, 2: { ...p }, 3: { ...p } };
}

const SUBJECT_NAMES = ["국어", "수학", "영어", "과학"];

function subjects(): GradeSubjects {
  return {
    1: SUBJECT_NAMES.map((name) => ({ set: "공통", name, units: 4, classCount: 2 })),
    2: [],
    3: [],
  };
}

/** Teacher `name` teaching `subjectName` to grade-1 classes with these hours. */
function teacher(name: string, subjectName: string, classHours: number[]): Teacher {
  const assignments = createEmptyTeacherAssignments();
  assignments[1] = [
    { name: subjectName, hours: classHours.reduce((a, b) => a + b, 0), classHours },
  ];
  return { name, assignments };
}

function run(teachers: Teacher[], forbiddenSlots = [] as { teacherName: string; day: "mon"; period: number }[]) {
  return solveLunchPriority({
    teachers,
    subjects: subjects(),
    classCounts: { 1: 2, 2: 0, 3: 0 },
    schedules: mondayOnly(),
    wholeCells: [],
    partialCells: [],
    forbiddenSlots,
    lunchAfterPeriod: 4,
    timeLimitMs: 1000,
    restarts: 5,
  });
}

describe("solveLunchPriority", () => {
  it("finds a full assignment that needs re-routing earlier choices", () => {
    // 1-2 can only be covered by 김 and 최, so 김 must not be spent on 1-1.
    const result = run([
      teacher("김", "국어", [3, 3]),
      teacher("이", "수학", [3, 0]),
      teacher("박", "영어", [3, 0]),
      teacher("최", "과학", [0, 3]),
    ]);
    assert.equal(result.targetCount, 4);
    assert.equal(result.filledCount, 4);
    assert.equal(result.status, "ready");
    assert.equal(listLunchTeacherDoubles(result.cells, 4).length, 0);
  });

  it("reports a per-day structural shortfall when teachers run out", () => {
    // 4 lunch slots but only 3 teachers, each limited to one slot per day.
    const result = run([
      teacher("김", "국어", [3, 3]),
      teacher("이", "수학", [3, 3]),
      teacher("박", "영어", [3, 3]),
    ]);
    assert.equal(result.filledCount, 3);
    assert.equal(result.status, "failed");
    assert.match(result.message, /월요일은 4칸 중 최대 3칸/);
    assert.match(result.message, /다시 시도해도 채워지지 않으니/);
    assert.doesNotMatch(result.message, /시수를 여러 요일이 나눠 쓰면서/);
  });

  it("yields a different full arrangement when pressed again", () => {
    // 4 slots, 4 interchangeable teachers: many equally full answers exist.
    const teachers = [
      teacher("김", "국어", [3, 3]),
      teacher("이", "수학", [3, 3]),
      teacher("박", "영어", [3, 3]),
      teacher("최", "과학", [3, 3]),
    ];
    const signatures = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const result = run(teachers);
      assert.equal(result.filledCount, 4);
      signatures.add(
        result.lunchCells
          .map((c) => `${c.classNo}-${c.period}-${c.teacherName}`)
          .sort()
          .join(","),
      );
    }
    assert.ok(signatures.size > 1, "every press returned the same arrangement");
  });

  it("says how the arrangement changed from the previous press", () => {
    const teachers = [
      teacher("김", "국어", [3, 3]),
      teacher("이", "수학", [3, 3]),
      teacher("박", "영어", [3, 3]),
      teacher("최", "과학", [3, 3]),
    ];
    const first = run(teachers);
    assert.doesNotMatch(first.message, /이전 배치/);

    const same = solveLunchPriority({
      teachers,
      subjects: subjects(),
      classCounts: { 1: 2, 2: 0, 3: 0 },
      schedules: mondayOnly(),
      wholeCells: [],
      partialCells: [],
      lunchAfterPeriod: 4,
      previousLunchCells: first.lunchCells,
    });
    assert.match(same.message, /이전 배치(와 비교해 \d+칸이 바뀌었습니다|와 같은 결과입니다)/);
  });

  it("lists which lunch cells stayed empty", () => {
    const result = run([
      teacher("김", "국어", [3, 3]),
      teacher("이", "수학", [3, 3]),
      teacher("박", "영어", [3, 3]),
    ]);
    assert.match(result.message, /비어 있는 칸: 월 1-[12]반 [45]교시/);
  });

  it("does not treat 배정 불가 on the partner period as a lesson", () => {
    // 최 can't teach Monday 5교시, which must not stop them taking 4교시.
    const result = run(
      [
        teacher("김", "국어", [3, 3]),
        teacher("이", "수학", [3, 3]),
        teacher("박", "영어", [3, 3]),
        teacher("최", "과학", [3, 3]),
      ],
      [{ teacherName: "최", day: "mon", period: 5 }],
    );
    assert.equal(result.filledCount, 4);
    const choi = result.lunchCells.filter((c) => c.teacherName === "최");
    assert.equal(choi.length, 1);
    assert.equal(choi[0].period, 4);
  });
});

describe("listLunchTeacherDoubles", () => {
  it("orders entries Mon→Fri, not alphabetically by day key", () => {
    const days = ["fri", "thu", "tue", "mon", "wed"] as const;
    const cells = days.flatMap((day) =>
      [4, 5].map((period) => ({
        grade: 1 as const,
        classNo: 1,
        day,
        period,
        subjectName: "국어",
        teacherName: "김",
        kind: "common" as const,
      })),
    );
    const order = listLunchTeacherDoubles(cells, 4).map((d) => d.day);
    assert.deepEqual(order, ["mon", "tue", "wed", "thu", "fri"]);
  });
});
