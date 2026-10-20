import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogGradeSets, countPlaced, sameSetInternalTeacherConflicts, slotKey } from "@/lib/set-blocks";
import {
  autoPlacePartialSets,
  autoPlaceWholeSets,
  formatAutoPlaceOutcome,
} from "@/lib/set-blocks-auto";
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

function periods(overrides: Partial<WeekdayPeriods> = {}): WeekdayPeriods {
  return { mon: 7, tue: 7, wed: 7, thu: 7, fri: 7, ...overrides };
}

function schedulesOf(p: WeekdayPeriods): GradeDaySchedules {
  return { 1: { ...p }, 2: { ...p }, 3: { ...p } };
}

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

/** Deterministic PRNG (mulberry32) for reproducible auto-place runs. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

describe("autoPlaceWholeSets", () => {
  it("places each whole SET exactly its unit count", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 3, 1),
        setRow("A", "화학", 3, 2),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 3),
      teacher("이화학", 1, "화학", 3),
    ];

    const result = autoPlaceWholeSets({
      cells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.equal(countPlaced(result.cells, 1, "A"), 3);
    const keys = result.cells.map((c) => slotKey(c.day, c.period));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("does not place two grades' SETs on the same slot when they share a teacher", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [setRow("A", "물리1", 1, 1), setRow("A", "화학1", 1, 2)],
      2: [setRow("A", "물리2", 1, 1), setRow("A", "화학2", 1, 2)],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김공유", 1, "물리1", 1),
      teacher("박1", 1, "화학1", 1),
      teacher("김공유", 2, "물리2", 1),
      teacher("박2", 2, "화학2", 1),
    ];

    const result = autoPlaceWholeSets({
      cells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods({ mon: 1, tue: 0, wed: 0, thu: 0, fri: 0 })),
      classCounts: counts,
    });

    assert.equal(result.cells.length, 1);
    assert.equal(result.unplaced.length, 1);
    assert.equal(result.unplaced[0].remaining, 1);
  });

  it("spreads the same SET across different days when units allow", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 3, 1),
        setRow("A", "화학", 3, 2),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 3),
      teacher("이화학", 1, "화학", 3),
    ];

    const result = autoPlaceWholeSets({
      cells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    const days = new Set(result.cells.map((c) => c.day));
    assert.equal(result.unplaced.length, 0);
    assert.equal(days.size, 3);
  });

  it("keeps already painted cells and only fills the rest", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 2, 1),
        setRow("A", "화학", 2, 2),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 2),
      teacher("이화학", 1, "화학", 2),
    ];
    const existing = [{ grade: 1 as const, set: "A" as const, day: "fri" as const, period: 7 }];

    const result = autoPlaceWholeSets({
      cells: existing,
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.equal(countPlaced(result.cells, 1, "A"), 2);
    assert.ok(
      result.cells.some((c) => c.day === "fri" && c.period === 7 && c.set === "A"),
    );
  });

  it("avoids eating the only remaining slots a same-grade partial SET needs", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 1, 1),
        setRow("A", "화학", 1, 2),
        setRow("B", "생명", 2, 1),
      ],
      2: [
        setRow("A", "지구", 1, 1),
        setRow("A", "운동", 1, 2),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("이물리", 1, "물리", 1),
      teacher("이화학", 1, "화학", 1),
      teacher("김생명", 1, "생명", 2),
      teacher("김생명", 2, "지구", 1),
      teacher("박운동", 2, "운동", 1),
    ];
    const tight = schedulesOf(periods({ mon: 3, tue: 0, wed: 0, thu: 0, fri: 0 }));
    const grade2Locked = [
      { grade: 2 as const, set: "A" as const, day: "mon" as const, period: 1 },
    ];

    const result = autoPlaceWholeSets({
      cells: grade2Locked,
      partialCells: [],
      catalog,
      teachers,
      schedules: tight,
      classCounts: counts,
    });

    const grade1Whole = result.cells.find((c) => c.grade === 1 && c.set === "A");
    assert.ok(grade1Whole);
    assert.equal(grade1Whole.day, "mon");
    assert.equal(grade1Whole.period, 1);
    assert.equal(result.unplaced.length, 0);
  });

  it("produces different layouts across runs instead of a fixed one", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [setRow("A", "물리", 3, 1), setRow("A", "화학", 3, 2)],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 3),
      teacher("이화학", 1, "화학", 3),
    ];

    const layouts = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const result = autoPlaceWholeSets({
        cells: [],
        partialCells: [],
        catalog,
        teachers,
        schedules: schedulesOf(periods()),
        classCounts: counts,
        random: seededRandom(seed),
      });
      assert.equal(result.unplaced.length, 0);
      assert.equal(new Set(result.cells.map((c) => c.day)).size, 3);
      layouts.add(
        result.cells
          .map((c) => slotKey(c.day, c.period))
          .sort()
          .join(","),
      );
    }
    assert.ok(layouts.size > 1);
  });

  it("is reproducible with the same injected random source", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [setRow("A", "물리", 3, 1), setRow("A", "화학", 3, 2)],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 3),
      teacher("이화학", 1, "화학", 3),
    ];
    const run = () =>
      autoPlaceWholeSets({
        cells: [],
        partialCells: [],
        catalog,
        teachers,
        schedules: schedulesOf(periods()),
        classCounts: counts,
        random: seededRandom(42),
      }).cells;

    assert.deepEqual(run(), run());
  });

  it("warns when filling whole SETs leaves a partial SET without slots", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 1, 1),
        setRow("A", "화학", 1, 2),
        setRow("B", "생명", 1, 1),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("이물리", 1, "물리", 1),
      teacher("이화학", 1, "화학", 1),
      teacher("김생명", 1, "생명", 1),
    ];

    const result = autoPlaceWholeSets({
      cells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods({ mon: 1, tue: 0, wed: 0, thu: 0, fri: 0 })),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.deepEqual(
      result.partialShortfalls.map((s) => [s.grade, s.set, s.remaining]),
      [[1, "B", 1]],
    );
    assert.ok(result.warnings.some((w) => w.includes("SET B")));
    assert.equal(formatAutoPlaceOutcome("전학년 SET", result).error, true);
  });

  it("reports no partial shortfall when partial SETs still fit", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 1, 1),
        setRow("A", "화학", 1, 2),
        setRow("B", "생명", 1, 1),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("이물리", 1, "물리", 1),
      teacher("이화학", 1, "화학", 1),
      teacher("김생명", 1, "생명", 1),
    ];

    const result = autoPlaceWholeSets({
      cells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods({ mon: 2, tue: 0, wed: 0, thu: 0, fri: 0 })),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.equal(result.partialShortfalls.length, 0);
    assert.equal(formatAutoPlaceOutcome("전학년 SET", result).error, false);
  });

  it("applies a teacher rotation when a SET subject is shared", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 2, 1),
        setRow("A", "화학", 2, 2),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 1),
      teacher("박물리", 1, "물리", 1),
      teacher("이화학", 1, "화학", 2),
    ];

    const result = autoPlaceWholeSets({
      cells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    const physics = result.assignments.filter((a) => a.subjectName === "물리");
    assert.equal(result.unplaced.length, 0);
    assert.equal(physics.length, 2);
    assert.deepEqual(
      [...new Set(physics.map((a) => a.teacherName))].sort(),
      ["김물리", "박물리"],
    );
  });
});

describe("autoPlacePartialSets", () => {
  it("places partial SETs without overlapping home rooms at the same slot", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 1, 1),
        setRow("B", "화학", 1, 1),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 1),
      teacher("이화학", 1, "화학", 1),
    ];

    const result = autoPlacePartialSets({
      wholeCells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods({ mon: 1, tue: 0, wed: 0, thu: 0, fri: 0 })),
      classCounts: counts,
    });

    assert.equal(result.cells.length, 1);
    assert.equal(result.unplaced.length, 1);
  });

  it("allows two partial SETs to share a slot when rooms do not overlap", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [
        setRow("A", "물리", 1, 1),
        setRow("B", "화학", 1, 2),
      ],
    };
    const counts = classCounts(2);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김물리", 1, "물리", 1),
      teacher("이화학", 1, "화학", 1),
    ];

    const result = autoPlacePartialSets({
      wholeCells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods({ mon: 1, tue: 0, wed: 0, thu: 0, fri: 0 })),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.equal(result.cells.length, 2);
    assert.ok(result.cells.every((c) => c.day === "mon" && c.period === 1));
  });

  it("does not place a SET whose sole teacher covers two of its subjects", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [setRow("A", "물리", 2, 1), setRow("A", "화학", 2, 2)],
    };
    const counts = classCounts(3);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김공유", 1, "물리", 2),
      teacher("김공유", 1, "화학", 2),
    ];

    const result = autoPlacePartialSets({
      wholeCells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    assert.equal(result.cells.length, 0);
    assert.equal(result.unplaced.length, 1);
    assert.equal(result.unplaced[0].remaining, 2);
    assert.ok(result.warnings.some((w) => w.includes("김공유")));
  });

  it("does not apply a rotation that would overlap a sole teacher in the same SET", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [setRow("A", "물리", 2, 1), setRow("A", "화학", 2, 2)],
    };
    const counts = classCounts(3);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김공유", 1, "물리", 1),
      teacher("이물리", 1, "물리", 1),
      teacher("김공유", 1, "화학", 2),
    ];

    const result = autoPlacePartialSets({
      wholeCells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.equal(
      sameSetInternalTeacherConflicts(
        [],
        result.cells,
        teachers,
        catalog,
        result.assignments,
      ).length,
      0,
    );
    assert.equal(
      result.assignments.filter((a) => a.subjectName === "물리").length,
      0,
    );
    assert.ok(result.warnings.some((w) => w.includes("물리")));
  });

  it("picks a rotation that keeps two rotating subjects from sharing a teacher at a slot", () => {
    const subjects: GradeSubjects = {
      ...emptySubjects(),
      1: [setRow("A", "물리", 2, 1), setRow("A", "화학", 2, 2)],
    };
    const counts = classCounts(3);
    const catalog = catalogGradeSets(subjects, counts);
    const teachers = [
      teacher("김공유", 1, "물리", 1),
      teacher("이물리", 1, "물리", 1),
      teacher("김공유", 1, "화학", 1),
      teacher("박화학", 1, "화학", 1),
    ];

    const result = autoPlacePartialSets({
      wholeCells: [],
      partialCells: [],
      catalog,
      teachers,
      schedules: schedulesOf(periods()),
      classCounts: counts,
    });

    assert.equal(result.unplaced.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(
      sameSetInternalTeacherConflicts(
        [],
        result.cells,
        teachers,
        catalog,
        result.assignments,
      ).length,
      0,
    );
    const physics = result.assignments.filter((a) => a.subjectName === "물리");
    const chem = result.assignments.filter((a) => a.subjectName === "화학");
    assert.equal(physics.length, 2);
    assert.equal(chem.length, 2);
    for (const slot of result.cells) {
      const p = physics.find((a) => a.day === slot.day && a.period === slot.period);
      const c = chem.find((a) => a.day === slot.day && a.period === slot.period);
      assert.ok(p && c);
      assert.notEqual(p.teacherName, c.teacherName);
    }
  });
});
