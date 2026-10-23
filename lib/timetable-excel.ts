import type { Borders, Fill, Workbook, Worksheet } from "exceljs";
import { shortSubjectName } from "@/lib/subjects";
import { hasTeacherGroupSections, teacherSections, type TeacherSection } from "@/lib/teachers";
import { anyGradeHasPeriod, cellsForClass, cellsForTeacher, maxPeriods, maxPeriodsAllGrades } from "@/lib/timetable";
import {
  GRADES,
  WEEKDAYS,
  type GradeClassCounts,
  type GradeDaySchedules,
  type Teacher,
  type TimetableCell,
  type Weekday,
} from "@/lib/types";

const THIN = { style: "thin", color: { argb: "FFA1A1AA" } } as const;
const BORDER: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4E4E7" } } as const;
const OFF_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4D4D8" } } as const;
const CENTER = { horizontal: "center", vertical: "middle", wrapText: true } as const;
const GRAY_TEXT = { argb: "FF71717A" };
const CONFLICT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } } as const;

/** SET 칸 배경: 화면(subjectSetBadgeClass)과 같은 색 계열을 인쇄에서도 보이게 한 단계 진하게 */
const SET_COLORS: Record<string, string> = {
  A: "FFFFE4E6",
  B: "FFFFEDD5",
  C: "FFFEF3C7",
  D: "FFECFCCB",
  E: "FFD1FAE5",
  F: "FFCCFBF1",
  G: "FFE0F2FE",
  H: "FFE0E7FF",
  I: "FFFAE8FF",
};
const setFill = (set: string | undefined): Fill | undefined =>
  set && SET_COLORS[set] ? { type: "pattern", pattern: "solid", fgColor: { argb: SET_COLORS[set] } } : undefined;
/** 칸에 든 수업 중 SET 수업의 SET */
const setOf = (lessons: TimetableCell[]) => lessons.find((c) => c.kind === "set")?.set;

/** 한 덩어리: 제목 줄, 요일 머리 줄, 교시 줄들, 빈 줄. 수업이 없는 교시는 회색, SET 수업은 SET 색으로 칠한다 */
function addBlock(
  sheet: Worksheet,
  title: string,
  periods: number,
  isActive: (day: Weekday, period: number) => boolean,
  text: (day: Weekday, period: number) => string,
  setAt: (day: Weekday, period: number) => string | undefined,
) {
  const titleRow = sheet.addRow([title]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, WEEKDAYS.length + 1);
  titleRow.font = { bold: true, size: 12 };
  titleRow.alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 22;

  const header = sheet.addRow(["교시", ...WEEKDAYS.map((d) => d.label)]);
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = CENTER;
  });

  for (let period = 1; period <= periods; period += 1) {
    const row = sheet.addRow([period, ...WEEKDAYS.map(({ key }) => (isActive(key, period) ? text(key, period) : ""))]);
    row.height = 32;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.alignment = CENTER;
      if (col === 1) {
        cell.font = { bold: true };
        cell.fill = HEADER_FILL;
      } else if (!isActive(WEEKDAYS[col - 2].key, period)) {
        cell.fill = OFF_FILL;
      } else {
        const fill = setFill(setAt(WEEKDAYS[col - 2].key, period));
        if (fill) cell.fill = fill;
      }
    });
  }

  sheet.addRow([]);
}

async function newSheet(
  name: string,
  orientation: "portrait" | "landscape",
): Promise<{ workbook: Workbook; sheet: Worksheet }> {
  // exceljs는 CommonJS라 불러오는 방식에 따라 이름 있는 내보내기가 default 아래에만 있다
  const mod = await import("exceljs");
  const { Workbook } = mod.default ?? mod;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(name, {
    pageSetup: { paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  return { workbook, sheet };
}

/** 반·교사 블록을 쌓는 시트 (A4 세로, 교시 열 + 요일 5열) */
async function newBlockSheet(name: string) {
  const made = await newSheet(name, "portrait");
  made.sheet.columns = [{ width: 6 }, ...WEEKDAYS.map(() => ({ width: 18 }))];
  return made;
}

type TimetableInput = {
  cells: TimetableCell[];
  schedules: GradeDaySchedules;
  /** "2026학년도 2학기". 블록 제목 앞에 붙는다 (비어 있으면 생략) */
  termLabel: string;
};

type TeacherInput = TimetableInput & {
  teachers: Teacher[];
  /** 교사 그룹 순서 (있으면 화면과 같이 그룹별로 나눈다) */
  groups?: string[];
};

const sectionLabel = (section: TeacherSection) => `${section.group ?? "그룹 없음"} (${section.names.length}명)`;

const blockTitle = (termLabel: string, name: string) => (termLabel ? `${termLabel}  ${name} 시간표` : `${name} 시간표`);

/** 학반별 시간표 엑셀: 한 시트에 1학년 1반부터 3학년 끝 반까지 차례로 쌓는다 */
export async function buildClassTimetablesXlsx({
  cells,
  schedules,
  termLabel,
  classCounts,
}: TimetableInput & { classCounts: GradeClassCounts }) {
  const { workbook, sheet } = await newBlockSheet("학반별 시간표");
  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= (classCounts[grade] ?? 0); classNo += 1) {
      const classCells = cellsForClass(cells, grade, classNo);
      addBlock(
        sheet,
        blockTitle(termLabel, `${grade}학년 ${classNo}반`),
        maxPeriods(schedules, grade),
        (day, period) => (schedules[grade][day] ?? 0) >= period,
        (day, period) => {
          const cell = classCells.find((c) => c.day === day && c.period === period);
          return cell ? `${cell.subjectName}\n${cell.teacherName}` : "";
        },
        (day, period) => setOf(classCells.filter((c) => c.day === day && c.period === period)),
      );
    }
  }
  return workbook.xlsx.writeBuffer();
}

/**
 * 교사별 시간표 엑셀: 한 시트에 교사를 화면의 교사 보기와 같은 순서로 차례로 쌓는다.
 * 그룹이 있으면 그룹마다 머리줄을 넣고 그 그룹 교사를 명단 순서로, 없으면 가나다순.
 */
export async function buildTeacherTimetablesXlsx({ cells, schedules, termLabel, teachers, groups }: TeacherInput) {
  const { workbook, sheet } = await newBlockSheet("교사별 시간표");
  const periods = maxPeriodsAllGrades(schedules);
  const sections = teacherSections(teachers, groups);
  const showHeadings = hasTeacherGroupSections(sections);
  for (const section of sections) {
    if (showHeadings) {
      const heading = sheet.addRow([`■ ${sectionLabel(section)}`]);
      sheet.mergeCells(heading.number, 1, heading.number, WEEKDAYS.length + 1);
      heading.font = { bold: true, size: 13 };
      heading.alignment = { horizontal: "left", vertical: "middle" };
      heading.getCell(1).fill = HEADER_FILL;
      heading.height = 24;
    }
    for (const name of section.names) addTeacherBlock(sheet, cells, schedules, termLabel, periods, name);
  }
  return workbook.xlsx.writeBuffer();
}

function addTeacherBlock(
  sheet: Worksheet,
  cells: TimetableCell[],
  schedules: GradeDaySchedules,
  termLabel: string,
  periods: number,
  name: string,
) {
  const teacherCells = cellsForTeacher(cells, name);
  addBlock(
    sheet,
    blockTitle(termLabel, `${name} 선생님`),
    periods,
    (day, period) => anyGradeHasPeriod(schedules, day, period),
    (day, period) =>
      teacherCells
        .filter((c) => c.day === day && c.period === period)
        .map((c) => `${c.grade}-${c.classNo}\n${c.subjectName}`)
        .join("\n"),
    (day, period) => setOf(teacherCells.filter((c) => c.day === day && c.period === period)),
  );
}

type WideRow = {
  label: string;
  /** 위에 굵은 가로줄 (학년이 바뀌는 줄) */
  groupStart?: boolean;
  isActive: (day: Weekday, period: number) => boolean;
  /** 칸에 든 수업들. 둘 이상이면 겹친 수업이라 붉게 칠한다 */
  lessons: (day: Weekday, period: number) => TimetableCell[];
  /** 수업 하나를 [윗줄, 회색 아랫줄]로 */
  lines: (lesson: TimetableCell) => [string, string];
};

/** 표 전체 폭의 구분 머리줄 (교사 그룹) */
type WideHeading = { heading: string };

/** 한 장짜리 넓은 표: 세로는 반·교사, 가로는 요일마다 교시들 */
async function buildWideTableXlsx({
  name,
  termLabel,
  headLabel,
  headWidth,
  periods,
  rows,
}: {
  name: string;
  termLabel: string;
  headLabel: string;
  headWidth: number;
  periods: number;
  rows: (WideRow | WideHeading)[];
}) {
  const { workbook, sheet } = await newSheet(name, "landscape");
  const lastCol = 1 + periods * WEEKDAYS.length;
  const colOf = (dayIndex: number, period: number) => 2 + dayIndex * periods + (period - 1);
  sheet.columns = [{ width: headWidth }, ...Array.from({ length: lastCol - 1 }, () => ({ width: 8 }))];

  const title = sheet.addRow([termLabel ? `${termLabel}  ${name}` : name]);
  sheet.mergeCells(title.number, 1, title.number, lastCol);
  title.font = { bold: true, size: 12 };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.height = 22;

  const dayRow = sheet.addRow([]);
  const periodRow = sheet.addRow([]);
  dayRow.getCell(1).value = headLabel;
  sheet.mergeCells(dayRow.number, 1, periodRow.number, 1);
  WEEKDAYS.forEach(({ label }, dayIndex) => {
    dayRow.getCell(colOf(dayIndex, 1)).value = label;
    sheet.mergeCells(dayRow.number, colOf(dayIndex, 1), dayRow.number, colOf(dayIndex, periods));
    for (let period = 1; period <= periods; period += 1) periodRow.getCell(colOf(dayIndex, period)).value = period;
  });
  for (const row of [dayRow, periodRow]) {
    for (let col = 1; col <= lastCol; col += 1) {
      const cell = row.getCell(col);
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.border = BORDER;
      cell.alignment = CENTER;
    }
  }

  const headingRows = new Set<number>();
  for (const spec of rows) {
    if ("heading" in spec) {
      const heading = sheet.addRow([spec.heading]);
      sheet.mergeCells(heading.number, 1, heading.number, lastCol);
      heading.font = { bold: true };
      heading.alignment = { horizontal: "left", vertical: "middle" };
      heading.getCell(1).fill = HEADER_FILL;
      heading.getCell(1).border = { ...BORDER, top: { style: "medium" } };
      heading.height = 20;
      headingRows.add(heading.number);
      continue;
    }
    const row = sheet.addRow([spec.label]);
    row.height = 30;
    for (let col = 1; col <= lastCol; col += 1) {
      const cell = row.getCell(col);
      cell.border = spec.groupStart ? { ...BORDER, top: { style: "medium" } } : BORDER;
      cell.alignment = CENTER;
    }
    row.getCell(1).font = { bold: true };
    row.getCell(1).fill = HEADER_FILL;
    WEEKDAYS.forEach(({ key }, dayIndex) => {
      for (let period = 1; period <= periods; period += 1) {
        const cell = row.getCell(colOf(dayIndex, period));
        if (!spec.isActive(key, period)) {
          cell.fill = OFF_FILL;
          continue;
        }
        const lessons = spec.lessons(key, period);
        if (lessons.length === 0) continue;
        const fill = lessons.length > 1 ? CONFLICT_FILL : setFill(setOf(lessons));
        if (fill) cell.fill = fill;
        cell.value = {
          richText: lessons.map(spec.lines).flatMap(([main, sub], i) => [
            { text: `${main}\n` },
            { text: i < lessons.length - 1 ? `${sub}\n` : sub, font: { color: GRAY_TEXT } },
          ]),
        };
      }
    });
  }

  // 요일 사이 굵은 세로줄
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === title.number || headingRows.has(rowNumber)) return;
    WEEKDAYS.forEach((_, dayIndex) => {
      const cell = row.getCell(colOf(dayIndex, 1));
      cell.border = { ...cell.border, left: { style: "medium" } };
    });
  });
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: periodRow.number }];

  return workbook.xlsx.writeBuffer();
}

/**
 * 전체 학년 시간표 엑셀: 화면의 "전체 학년 시간표"와 같은 한 장짜리 표.
 * 세로는 1-1부터 3학년 끝 반. 칸에는 화면처럼 줄인 과목 이름과 그 아래 교사 이름을 넣는다.
 */
export async function buildGradeTimetableXlsx({
  cells,
  schedules,
  termLabel,
  classCounts,
}: TimetableInput & { classCounts: GradeClassCounts }) {
  const bySlot = new Map(cells.map((c) => [`${c.grade}|${c.classNo}|${c.day}|${c.period}`, c]));
  const firstGrade = GRADES.find((g) => (classCounts[g] ?? 0) > 0);
  const rows: WideRow[] = GRADES.flatMap((grade) =>
    Array.from({ length: classCounts[grade] ?? 0 }, (_, i) => {
      const classNo = i + 1;
      return {
        label: `${grade}-${classNo}`,
        groupStart: classNo === 1 && grade !== firstGrade,
        isActive: (day: Weekday, period: number) => (schedules[grade][day] ?? 0) >= period,
        lessons: (day: Weekday, period: number) => {
          const lesson = bySlot.get(`${grade}|${classNo}|${day}|${period}`);
          return lesson ? [lesson] : [];
        },
        lines: (lesson: TimetableCell): [string, string] => [shortSubjectName(lesson.subjectName), lesson.teacherName],
      };
    }),
  );
  return buildWideTableXlsx({
    name: "전체 학년 시간표",
    termLabel,
    headLabel: "학반",
    headWidth: 6,
    periods: maxPeriodsAllGrades(schedules),
    rows,
  });
}

/**
 * 전체 교사 시간표 엑셀: 화면의 "전체 교사 시간표"와 같은 한 장짜리 표.
 * 세로는 화면과 같은 교사 순서 (그룹이 있으면 그룹 머리줄 + 명단 순서, 없으면 가나다순).
 * 칸에는 학년-반과 그 아래 줄인 과목 이름을 넣는다.
 */
export async function buildAllTeachersTimetableXlsx({ cells, schedules, termLabel, teachers, groups }: TeacherInput) {
  const sections = teacherSections(teachers, groups);
  const showHeadings = hasTeacherGroupSections(sections);
  const rows = sections.flatMap((section): (WideRow | WideHeading)[] => [
    ...(showHeadings ? [{ heading: sectionLabel(section) }] : []),
    ...section.names.map((name): WideRow => {
      const teacherCells = cellsForTeacher(cells, name);
      return {
        label: name,
        isActive: (day, period) => anyGradeHasPeriod(schedules, day, period),
        lessons: (day, period) => teacherCells.filter((c) => c.day === day && c.period === period),
        lines: (c) => [`${c.grade}-${c.classNo}`, shortSubjectName(c.subjectName)],
      };
    }),
  ]);
  return buildWideTableXlsx({
    name: "전체 교사 시간표",
    termLabel,
    headLabel: "교사",
    headWidth: 9,
    periods: maxPeriodsAllGrades(schedules),
    rows,
  });
}

export function downloadXlsx(buffer: BlobPart, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
