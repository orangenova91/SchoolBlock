import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogGradeSets } from "@/lib/set-blocks";
import {
  findSubjectBlockSetConflicts,
  formatSubjectBlockSetConflict,
  formatTeacherClassPlacement,
  teacherBusyElsewhereBySlot,
  teacherOtherClassPlacedCount,
  teacherPlacementsByClass,
} from "@/lib/subject-blocks";
import {
  createEmptyTeacherAssignments,
  type Grade,
  type GradeClassCounts,
  type GradeSubjects,
  type Subject,
  type Teacher,
} from "@/lib/types";

function classCounts(n: number): GradeClassCounts {
  return { 1: n, 2: n, 3: n };
}

function emptySubjects(): GradeSubjects {
  return { 1: [], 2: [], 3: [] };
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

describe("findSubjectBlockSetConflicts", () => {
  it("flags a subject block on a whole-SET class slot", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        { set: "공통", name: "국어", units: 4, classCount: 2 },
        setRow("A", "물리", 1, 1),
        setRow("A", "화학", 1, 2),
      ],
    };
    const counts = classCounts(2);
    assert.equal(catalogGradeSets(subjects, counts)[0]?.kind, "whole");

    const conflicts = findSubjectBlockSetConflicts(
      [
        {
          grade: 1,
          classNo: 1,
          subjectName: "국어",
          teacherName: "박국어",
          day: "mon",
          period: 3,
        },
      ],
      [{ grade: 1, set: "A", day: "mon", period: 3 }],
      [],
      [
        teacher("박국어", 1, "국어", 4),
        teacher("김물리", 1, "물리", 1),
        teacher("이화학", 1, "화학", 1),
      ],
      subjects,
      counts,
    );

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, "set-lock");
    assert.match(
      formatSubjectBlockSetConflict(conflicts[0]),
      /1학년 1반 월3교시/,
    );
  });

  it("flags a subject block whose teacher is busy in another grade's SET", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [{ set: "공통", name: "국어", units: 4, classCount: 2 }],
      2: [setRow("A", "물리", 1, 1), setRow("A", "화학", 1, 2)],
    };
    const counts = classCounts(2);
    const kim: Teacher = {
      name: "김공유",
      assignments: {
        1: [{ name: "국어", hours: 4, classHours: [2, 2] }],
        2: [{ name: "물리", hours: 1, classHours: [1] }],
        3: [],
      },
    };

    const conflicts = findSubjectBlockSetConflicts(
      [
        {
          grade: 1,
          classNo: 1,
          subjectName: "국어",
          teacherName: "김공유",
          day: "tue",
          period: 2,
        },
      ],
      [{ grade: 2, set: "A", day: "tue", period: 2 }],
      [],
      [kim, teacher("이화학", 2, "화학", 1)],
      subjects,
      counts,
    );

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, "set-teacher");
    assert.equal(conflicts[0].setGrade, 2);
  });

  it("ignores a subject block that does not overlap SET", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        { set: "공통", name: "국어", units: 4, classCount: 2 },
        setRow("A", "물리", 1, 1),
        setRow("A", "화학", 1, 2),
      ],
    };
    const counts = classCounts(2);

    const conflicts = findSubjectBlockSetConflicts(
      [
        {
          grade: 1,
          classNo: 1,
          subjectName: "국어",
          teacherName: "박국어",
          day: "wed",
          period: 1,
        },
      ],
      [{ grade: 1, set: "A", day: "mon", period: 3 }],
      [],
      [
        teacher("박국어", 1, "국어", 4),
        teacher("김물리", 1, "물리", 1),
        teacher("이화학", 1, "화학", 1),
      ],
      subjects,
      counts,
    );

    assert.equal(conflicts.length, 0);
  });
});

describe("teacher placement summaries", () => {
  const cells = [
    {
      grade: 1 as const,
      classNo: 1,
      subjectName: "국어",
      teacherName: "박국어",
      day: "mon" as const,
      period: 1,
    },
    {
      grade: 1 as const,
      classNo: 1,
      subjectName: "국어",
      teacherName: "박국어",
      day: "tue" as const,
      period: 2,
    },
    {
      grade: 2 as const,
      classNo: 3,
      subjectName: "국어",
      teacherName: "박국어",
      day: "wed" as const,
      period: 3,
    },
    {
      grade: 3 as const,
      classNo: 1,
      subjectName: "영어",
      teacherName: "박국어",
      day: "thu" as const,
      period: 1,
    },
    {
      grade: 1 as const,
      classNo: 2,
      subjectName: "수학",
      teacherName: "이수학",
      day: "mon" as const,
      period: 1,
    },
  ];

  it("groups one teacher by class and subject", () => {
    const shares = teacherPlacementsByClass(cells, "박국어");
    assert.deepEqual(shares, [
      { grade: 1, classNo: 1, subjectName: "국어", placed: 2 },
      { grade: 2, classNo: 3, subjectName: "국어", placed: 1 },
      { grade: 3, classNo: 1, subjectName: "영어", placed: 1 },
    ]);
    assert.equal(
      formatTeacherClassPlacement(shares[1]),
      "2-3 국어 1",
    );
  });

  it("counts other classes by placed subject, not hours", () => {
    assert.equal(
      teacherOtherClassPlacedCount(cells, "박국어", 1, 1, "국어"),
      1,
    );
    assert.equal(
      teacherOtherClassPlacedCount(cells, "박국어", 1, 1, "영어"),
      1,
    );
    assert.equal(
      teacherOtherClassPlacedCount(cells, "박국어", 2, 3, "국어"),
      1,
    );
    assert.equal(
      teacherOtherClassPlacedCount(cells, "이수학", 1, 2, "수학"),
      0,
    );
  });

  it("maps other-class busy slots for the grid", () => {
    const busy = teacherBusyElsewhereBySlot(cells, "박국어", 1, 1);
    assert.equal(busy.size, 2);
    assert.equal(busy.get("wed|3")?.classNo, 3);
    assert.equal(busy.get("thu|1")?.grade, 3);
    assert.equal(busy.has("mon|1"), false);
  });
});
