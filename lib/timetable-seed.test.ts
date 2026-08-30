import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogGradeSets } from "@/lib/set-blocks";
import { buildSeedTimetableCells } from "@/lib/timetable";
import {
  createEmptyTeacherAssignments,
  type Grade,
  type GradeClassCounts,
  type GradeDaySchedules,
  type GradeSubjects,
  type Subject,
  type Teacher,
  type WeekdayPeriods,
} from "@/lib/types";

function periods(): WeekdayPeriods {
  return { mon: 7, tue: 7, wed: 7, thu: 7, fri: 7 };
}

function schedulesOf(): GradeDaySchedules {
  const p = periods();
  return { 1: { ...p }, 2: { ...p }, 3: { ...p } };
}

function classCounts(n: number): GradeClassCounts {
  return { 1: n, 2: n, 3: n };
}

function setRow(
  set: Subject["set"],
  name: string,
  units: number,
  classNo: number,
): Subject {
  return { set, name, units, classCount: 1, classNo };
}

function teacher(
  name: string,
  grade: Grade,
  subjectName: string,
  hours: number,
): Teacher {
  const assignments = createEmptyTeacherAssignments();
  assignments[grade] = [{ name: subjectName, hours, classHours: [hours] }];
  return { name, assignments };
}

describe("buildSeedTimetableCells", () => {
  it("includes SET slots and 선 수업 blocks before generation", () => {
    const subjects: GradeSubjects = {
      1: [
        { set: "공통", name: "국어", units: 4, classCount: 2 },
        setRow("A", "물리", 1, 1),
        setRow("A", "화학", 1, 2),
      ],
      2: [],
      3: [],
    };
    const counts = classCounts(2);
    assert.equal(catalogGradeSets(subjects, counts)[0]?.kind, "whole");

    const cells = buildSeedTimetableCells({
      teachers: [
        teacher("박국어", 1, "국어", 4),
        teacher("김물리", 1, "물리", 1),
        teacher("이화학", 1, "화학", 1),
      ],
      subjects,
      classCounts: counts,
      schedules: schedulesOf(),
      wholeCells: [{ grade: 1, set: "A", day: "mon", period: 1 }],
      partialCells: [],
      subjectBlocks: [
        {
          grade: 1,
          classNo: 1,
          subjectName: "국어",
          teacherName: "박국어",
          day: "tue",
          period: 2,
        },
      ],
    });

    const setCells = cells.filter((c) => c.kind === "set");
    const blocks = cells.filter((c) => c.kind === "common");
    assert.equal(setCells.length, 2);
    assert.ok(setCells.every((c) => c.day === "mon" && c.period === 1));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].subjectName, "국어");
    assert.equal(blocks[0].teacherName, "박국어");
    assert.equal(blocks[0].day, "tue");
  });

  it("returns an empty list when nothing is locked", () => {
    const cells = buildSeedTimetableCells({
      teachers: [],
      subjects: { 1: [], 2: [], 3: [] },
      classCounts: classCounts(1),
      schedules: schedulesOf(),
      wholeCells: [],
      partialCells: [],
      subjectBlocks: [],
    });
    assert.equal(cells.length, 0);
  });
});
