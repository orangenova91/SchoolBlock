import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeMovedFixedLessons,
  fixedLessonKeys,
  isFixedLesson,
  parseSlotRef,
  swapWholeSlots,
} from "@/lib/timetable-swap";
import {
  createDefaultGradeDaySchedules,
  type GradeDaySchedules,
  type TimetableCell,
} from "@/lib/types";

function common(
  grade: 1 | 2 | 3,
  classNo: number,
  day: TimetableCell["day"],
  period: number,
  subjectName: string,
  teacherName: string,
): TimetableCell {
  return { grade, classNo, day, period, subjectName, teacherName, kind: "common" };
}

const schedules = createDefaultGradeDaySchedules();
const options = { forbiddenSlots: [], schedules };

describe("swapWholeSlots", () => {
  it("moves every lesson of both columns, including SET lessons", () => {
    const cells: TimetableCell[] = [
      common(1, 1, "mon", 1, "국어", "김국어"),
      common(2, 3, "mon", 1, "수학", "이수학"),
      {
        grade: 3,
        classNo: 1,
        day: "mon",
        period: 1,
        subjectName: "물리",
        teacherName: "박물리·최물리",
        kind: "set",
        set: "A",
      },
      common(1, 1, "thu", 5, "영어", "정영어"),
      common(1, 2, "tue", 2, "체육", "한체육"),
    ];

    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 1 },
      { day: "thu", period: 5 },
      options,
    );
    assert.ok(!("error" in result));
    const at = (day: string, period: number) =>
      result.cells
        .filter((c) => c.day === day && c.period === period)
        .map((c) => c.subjectName)
        .sort();
    assert.deepEqual(at("thu", 5), ["국어", "물리", "수학"]);
    assert.deepEqual(at("mon", 1), ["영어"]);
    assert.deepEqual(at("tue", 2), ["체육"]);
    assert.equal(result.cells.length, cells.length);
  });

  it("allows moving a column into an empty column", () => {
    const cells = [common(1, 1, "mon", 2, "국어", "김국어")];
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 2 },
      { day: "fri", period: 7 },
      options,
    );
    assert.ok(!("error" in result));
    assert.equal(result.cells[0].day, "fri");
    assert.equal(result.cells[0].period, 7);
  });

  it("rejects when a grade with lessons lacks the destination period", () => {
    const short: GradeDaySchedules = {
      ...createDefaultGradeDaySchedules(),
      3: { mon: 7, tue: 7, wed: 7, thu: 7, fri: 4 },
    };
    const cells = [
      common(1, 1, "mon", 6, "국어", "김국어"),
      common(3, 1, "mon", 6, "수학", "이수학"),
    ];
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 6 },
      { day: "fri", period: 6 },
      { forbiddenSlots: [], schedules: short },
    );
    assert.ok("error" in result);
    assert.match(result.error, /3학년은 금6교시가 없습니다/);
  });

  it("ignores a short grade that has no lessons in the moving column", () => {
    const short: GradeDaySchedules = {
      ...createDefaultGradeDaySchedules(),
      3: { mon: 7, tue: 7, wed: 7, thu: 7, fri: 4 },
    };
    const cells = [common(1, 1, "mon", 6, "국어", "김국어")];
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 6 },
      { day: "fri", period: 6 },
      { forbiddenSlots: [], schedules: short },
    );
    assert.ok(!("error" in result));
  });

  it("rejects when a moving teacher is forbidden at the destination", () => {
    const cells = [
      common(1, 1, "mon", 1, "물리", "박물리·최물리"),
      common(1, 1, "tue", 3, "국어", "김국어"),
    ];
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 1 },
      { day: "tue", period: 3 },
      {
        forbiddenSlots: [{ teacherName: "최물리", day: "tue", period: 3 }],
        schedules,
      },
    );
    assert.ok("error" in result);
    assert.match(result.error, /최물리 교사는 화3교시에 배정 불가/);
  });

  it("rejects the same slot and two empty slots", () => {
    const cells = [common(1, 1, "mon", 1, "국어", "김국어")];
    assert.ok(
      "error" in
        swapWholeSlots(cells, { day: "mon", period: 1 }, { day: "mon", period: 1 }, options),
    );
    assert.ok(
      "error" in
        swapWholeSlots(cells, { day: "tue", period: 1 }, { day: "wed", period: 2 }, options),
    );
  });
});

describe("describeMovedFixedLessons", () => {
  const block = (
    classNo: number,
    day: TimetableCell["day"],
    period: number,
    subjectName: string,
  ) => ({ grade: 1 as const, classNo, day, period, subjectName, teacherName: "김교사" });

  it("names fixed lessons moved by a slot swap", () => {
    const cells = [
      common(1, 3, "mon", 1, "국어", "김교사"),
      common(1, 4, "mon", 1, "수학", "이교사"),
      common(1, 3, "tue", 2, "영어", "박교사"),
    ];
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 1 },
      { day: "tue", period: 2 },
      options,
    );
    assert.ok(!("error" in result));
    const notice = describeMovedFixedLessons(cells, result.cells, [
      block(3, "mon", 1, "국어"),
    ]);
    assert.equal(
      notice,
      "선 수업으로 고정된 1-3 국어(월1)도 함께 옮겨졌습니다. 시간표를 다시 생성하면 원래 자리로 돌아갑니다.",
    );
  });

  it("returns null when no fixed lesson moved", () => {
    const cells = [
      common(1, 3, "mon", 1, "국어", "김교사"),
      common(1, 3, "tue", 2, "영어", "박교사"),
      common(1, 3, "wed", 3, "과학", "최교사"),
    ];
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 1 },
      { day: "tue", period: 2 },
      options,
    );
    assert.ok(!("error" in result));
    assert.equal(
      describeMovedFixedLessons(cells, result.cells, [
        { ...block(3, "wed", 3, "과학"), teacherName: "최교사" },
      ]),
      null,
    );
  });

  it("summarizes more than three moved fixed lessons", () => {
    const cells = [1, 2, 3, 4, 5].map((n) =>
      common(1, n, "mon", 1, "국어", "김교사"),
    );
    const result = swapWholeSlots(
      cells,
      { day: "mon", period: 1 },
      { day: "fri", period: 3 },
      options,
    );
    assert.ok(!("error" in result));
    const notice = describeMovedFixedLessons(
      cells,
      result.cells,
      [1, 2, 3, 4, 5].map((n) => block(n, "mon", 1, "국어")),
    );
    assert.match(notice ?? "", /1-1 국어\(월1\), 1-2 국어\(월1\), 1-3 국어\(월1\) 외 2건도/);
  });
});

describe("isFixedLesson", () => {
  it("only marks common lessons still at their fixed slot", () => {
    const keys = fixedLessonKeys([
      {
        grade: 1,
        classNo: 1,
        day: "mon",
        period: 1,
        subjectName: "국어",
        teacherName: "김교사",
      },
    ]);
    assert.equal(isFixedLesson(common(1, 1, "mon", 1, "국어", "김교사"), keys), true);
    assert.equal(isFixedLesson(common(1, 1, "mon", 2, "국어", "김교사"), keys), false);
  });
});

describe("parseSlotRef", () => {
  it("accepts a valid slot and rejects malformed ones", () => {
    assert.deepEqual(parseSlotRef({ day: "wed", period: 3 }), {
      day: "wed",
      period: 3,
    });
    assert.equal(parseSlotRef({ day: "sun", period: 3 }), null);
    assert.equal(parseSlotRef({ day: "wed", period: 0 }), null);
    assert.equal(parseSlotRef({ day: "wed", period: 1.5 }), null);
    assert.equal(parseSlotRef(null), null);
  });
});
