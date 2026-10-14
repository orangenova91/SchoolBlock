import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultGenerationPreferences } from "@/lib/generation-preferences";
import { generateTimetable } from "@/lib/timetable";
import {
  createEmptyTeacherAssignments,
  type GradeDaySchedules,
  type GradeSubjects,
  type Teacher,
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

function teacher(name: string, subjectName: string, hours: number): Teacher {
  const assignments = createEmptyTeacherAssignments();
  assignments[1] = [{ name: subjectName, hours, classHours: [hours] }];
  return { name, assignments };
}

describe("generateTimetable soft preferences", () => {
  it("spreads a banned subject across days (동일 교과 같은 날 배치 금지)", () => {
    // 2 periods × 5 days, 국어 5h + 수학 5h: only a one-per-day layout has
    // zero same-day 국어 repeats, and random placement rarely finds it.
    for (let run = 0; run < 5; run++) {
      const result = generateTimetable({
        teachers: [teacher("김", "국어", 5), teacher("이", "수학", 5)],
        subjects: commonSubjects(["국어", "수학"]),
        classCounts: { 1: 1, 2: 0, 3: 0 },
        schedules: schedulesOf({ mon: 2, tue: 2, wed: 2, thu: 2, fri: 2 }),
        wholeCells: [],
        partialCells: [],
        preferences: {
          ...createDefaultGenerationPreferences(),
          avoidSameDaySubject: true,
          sameDaySubjectBans: [{ grade: 1, subjectName: "국어" }],
        },
        timeLimitMs: 1500,
        restarts: 4,
      });
      assert.equal(result.status, "ready");
      assert.equal(result.sameDaySubjectViolationCount, 0);
    }
  });

  it("completes a full timetable whose lunch slot can't avoid a double", () => {
    // One teacher fills all of Monday's 5 periods, so 4·5교시 is necessarily
    // a lunch double: the hard lunch pass is infeasible from the start and
    // must be skipped rather than leaving lessons unplaced.
    const result = generateTimetable({
      teachers: [teacher("김", "국어", 5)],
      subjects: commonSubjects(["국어"]),
      classCounts: { 1: 1, 2: 0, 3: 0 },
      schedules: schedulesOf({ mon: 5, tue: 0, wed: 0, thu: 0, fri: 0 }),
      wholeCells: [],
      partialCells: [],
      preferences: createDefaultGenerationPreferences(),
      timeLimitMs: 1500,
      restarts: 4,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.unplaced.length, 0);
    assert.equal(result.lunchDoubleCount, 1);
  });

  it("never moves a lesson onto a 배정 불가 slot while improving", () => {
    // 김 can't teach Monday 1교시; 2 periods × 5 days with a triple-free goal
    // gives the improver plenty of room to shuffle lessons around.
    for (let run = 0; run < 5; run++) {
      const result = generateTimetable({
        teachers: [teacher("김", "국어", 5), teacher("이", "수학", 5)],
        subjects: commonSubjects(["국어", "수학"]),
        classCounts: { 1: 1, 2: 0, 3: 0 },
        schedules: schedulesOf({ mon: 2, tue: 2, wed: 2, thu: 2, fri: 2 }),
        wholeCells: [],
        partialCells: [],
        forbiddenSlots: [{ teacherName: "김", day: "mon", period: 1 }],
        preferences: {
          ...createDefaultGenerationPreferences(),
          avoidSameDaySubject: true,
          sameDaySubjectBans: [{ grade: 1, subjectName: "국어" }],
        },
        timeLimitMs: 1500,
        restarts: 4,
      });
      assert.equal(result.status, "ready");
      const blocked = result.cells.filter(
        (c) => c.teacherName === "김" && c.day === "mon" && c.period === 1,
      );
      assert.equal(blocked.length, 0);
    }
  });
});
