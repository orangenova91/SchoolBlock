/**
 * v3 테스트용 작은 학교. 1학년 2반, 하루 3교시(점심은 2교시 뒤), 공통 3과목 + 학년 전체 SET 하나.
 * 테스트 파일에서만 쓴다.
 */
import { createEmptyTeacherAssignments, type GradeSubjects, type Teacher } from "@/lib/types";
import { buildV3Input, type V3Input } from "@/lib/v3/input";

function teacher(name: string, items: { name: string; classHours: number[] }[]): Teacher {
  const assignments = createEmptyTeacherAssignments();
  assignments[1] = items.map((i) => ({ name: i.name, classHours: i.classHours, hours: i.classHours.reduce((a, b) => a + b, 0) }));
  return { name, assignments };
}

export type TinyOptions = {
  /** A물리를 두 교사가 1회씩 나눠 맡음 (순환) */
  rotated?: boolean;
  /** 국어 시수 (반별) */
  koreanHours?: number;
  pins?: V3Input["pins"];
  forbidden?: V3Input["forbiddenSlots"];
  fixed?: { day: "mon" | "tue" | "wed" | "thu" | "fri"; period: number }[];
};

export function tinyInput(o: TinyOptions = {}): V3Input {
  const k = o.koreanHours ?? 4;
  const subjects: GradeSubjects = {
    1: [
      { set: "공통", name: "국어", units: k, classCount: 2 },
      { set: "공통", name: "수학", units: 4, classCount: 2 },
      { set: "공통", name: "영어", units: 3, classCount: 2 },
      { set: "A", name: "A물리", units: 2, classCount: 1, classNo: 1 },
      { set: "A", name: "A화학", units: 2, classCount: 1, classNo: 2 },
    ],
    2: [],
    3: [],
  };
  const teachers = [
    teacher("김국어", [{ name: "국어", classHours: [k, k] }]),
    teacher("이수학", [{ name: "수학", classHours: [4, 4] }]),
    teacher("박영어", [{ name: "영어", classHours: [3, 3] }]),
    ...(o.rotated
      ? [teacher("최물리", [{ name: "A물리", classHours: [1] }]), teacher("정물리", [{ name: "A물리", classHours: [1] }])]
      : [teacher("최물리", [{ name: "A물리", classHours: [2] }])]),
    teacher("한화학", [{ name: "A화학", classHours: [2] }]),
  ];
  const day = { mon: 3, tue: 3, wed: 3, thu: 3, fri: 3 };
  const zero = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
  return buildV3Input({
    teachers: { teachers },
    subjects: { subjects },
    daySchedule: { grades: { 1: day, 2: zero, 3: zero }, classCounts: { 1: 2, 2: 1, 3: 1 } },
    setBlocks: { cells: (o.fixed ?? []).map((f) => ({ grade: 1, set: "A", day: f.day, period: f.period })), partialCells: [], teacherAssignments: [] },
    subjectBlocks: { cells: o.pins ?? [] },
    constraints: { forbiddenSlots: o.forbidden ?? [] },
    preferences: { avoidLunchDouble: true, lunchAfterPeriod: 2, avoidTriplePeriod: true, avoidSameDaySubject: true, sameDaySubjectBans: [{ grade: 1, subjectName: "국어" }] },
  });
}
