import {
  createDefaultClassCounts,
  createDefaultGradeDaySchedules,
  createEmptyTeacherAssignments,
  DEFAULT_SUBJECT_SET,
  type GradeSubjects,
  type Subject,
  type Teacher,
} from "@/lib/types";
import { sanitizeGradeSubjects } from "@/lib/subjects";
import { sanitizeTeachers, syncAssignmentItem } from "@/lib/teachers";
import type { TermBundle } from "@/lib/term-bundle";
import demoSetExampleRaw from "@/lib/demo-seed-set-example.json";

/**
 * "체험해보기" 화면 표시용 이름 (헤더, 학기의 school 필드 등). 실제 DB
 * 계정명은 아니다 — 방문마다 {@link createDemoAccountUsername}으로 만든
 * 고유 계정을 세션에 담아 로그인시키고, 세션의 username 클레임만 이 값으로
 * 고정해 화면에는 항상 "데모계정"으로 보이게 한다. 방문자끼리 계정을 공유하지
 * 않으므로 한 사람의 진행 상황이 다른 사람 것을 지우는 일이 없다.
 */
export const DEMO_USERNAME = "데모계정";
/** SET(이동수업/선택) 없이 학반 공통 수업만 있는 첫 번째 예시. */
export const DEMO_TIMETABLE_NAME_NO_SET = "체험용 시간표 예시 (SET 없음)";
/** SET·부분 SET·교과 블록까지 들어있는 두 번째 예시 (실제 학교 데이터 기반). */
export const DEMO_TIMETABLE_NAME_WITH_SET = "체험용 시간표 예시 (SET 있음)";

/** 방문마다 생성되는 데모 계정의 실제 DB username 접두사 (정리 작업이 이걸로 식별한다). */
const DEMO_ACCOUNT_USERNAME_PREFIX = "__demo_데모계정_";

/** 이보다 오래된 데모 계정은 다음 "체험해보기" 클릭 때 함께 정리된다. */
export const DEMO_ACCOUNT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2시간

/** 방문마다 고유한 내부 계정명을 만든다. 사용자에게 노출되지 않는다. */
export function createDemoAccountUsername(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${DEMO_ACCOUNT_USERNAME_PREFIX}${Date.now().toString(36)}${random}`;
}

const DEMO_CLASS_COUNT = 4;

type DemoSubjectSeed = { name: string; units: number };

/**
 * 학년별 단위수 합이 주간 총 차시(요일 설정 7교시 × 5일 = 35)와 정확히
 * 일치해야 "수업 교과 설정(2/2)" 화면의 "다음" 버튼이 활성화된다
 * (SubjectsForm의 gradeTotalHours vs scheduleTotals 비교). 데모가 끝까지
 * 막힘없이 진행되도록 각 학년의 units 합을 35로 맞춘다.
 */
const DEMO_SUBJECTS_BY_GRADE: Record<1 | 2 | 3, DemoSubjectSeed[]> = {
  1: [
    { name: "국어", units: 5 },
    { name: "수학", units: 5 },
    { name: "영어", units: 5 },
    { name: "통합사회", units: 4 },
    { name: "통합과학", units: 4 },
    { name: "체육", units: 3 },
    { name: "음악", units: 2 },
    { name: "미술", units: 2 },
    { name: "기술가정", units: 2 },
    { name: "정보", units: 3 },
  ],
  2: [
    { name: "문학", units: 5 },
    { name: "수학Ⅰ", units: 5 },
    { name: "영어Ⅰ", units: 5 },
    { name: "한국사", units: 4 },
    { name: "사회문화", units: 4 },
    { name: "체육", units: 3 },
    { name: "음악", units: 2 },
    { name: "미술", units: 2 },
    { name: "정보", units: 2 },
    { name: "진로와직업", units: 3 },
  ],
  3: [
    { name: "화법과작문", units: 5 },
    { name: "미적분", units: 5 },
    { name: "영어독해와작문", units: 5 },
    { name: "생활과윤리", units: 4 },
    { name: "물리학Ⅰ", units: 4 },
    { name: "체육", units: 3 },
    { name: "음악", units: 2 },
    { name: "미술", units: 2 },
    { name: "정보", units: 2 },
    { name: "진로와직업", units: 3 },
  ],
};

type DemoTeacherAssignmentSeed = {
  grade: 1 | 2 | 3;
  subject: string;
  /** 학반별(1~4반) 주간 시수. 같은 교과·학년을 여러 교사가 학반을 나눠 맡을 수 있다. */
  classHours: [number, number, number, number];
};

type DemoTeacherSeed = {
  name: string;
  assignments: DemoTeacherAssignmentSeed[];
};

/**
 * 실제 학교처럼 같은 교과 영역(국어·수학·영어·사회·과학 등)의 교사가 여러
 * 학년에 걸쳐 나뉘어 들어가도록 구성한 교사 명단. 학년·교과별 학반 시수
 * 합계가 {@link DEMO_SUBJECTS_BY_GRADE}의 단위수 × 학반 수(=필요 시수)와
 * 정확히 일치해야 "교사 배정" 화면의 배정 시수가 100% 채워진다.
 * 전체 28명 × 평균 15.0시수(420시수 ÷ 28) = 요청받은 15~17 시수 범위.
 */
const DEMO_TEACHERS: DemoTeacherSeed[] = [
  // 국어영역: 1학년 국어 → 2학년 문학 → 3학년 화법과작문
  { name: "김민준", assignments: [{ grade: 1, subject: "국어", classHours: [5, 5, 5, 0] }] },
  {
    name: "이서연",
    assignments: [
      { grade: 1, subject: "국어", classHours: [0, 0, 0, 5] },
      { grade: 2, subject: "문학", classHours: [5, 5, 0, 0] },
    ],
  },
  {
    name: "박도윤",
    assignments: [
      { grade: 2, subject: "문학", classHours: [0, 0, 5, 5] },
      { grade: 3, subject: "화법과작문", classHours: [5, 0, 0, 0] },
    ],
  },
  { name: "최지우", assignments: [{ grade: 3, subject: "화법과작문", classHours: [0, 5, 5, 5] }] },

  // 수학영역: 1학년 수학 → 2학년 수학Ⅰ → 3학년 미적분
  { name: "정하은", assignments: [{ grade: 1, subject: "수학", classHours: [5, 5, 5, 0] }] },
  {
    name: "강서준",
    assignments: [
      { grade: 1, subject: "수학", classHours: [0, 0, 0, 5] },
      { grade: 2, subject: "수학Ⅰ", classHours: [5, 5, 0, 0] },
    ],
  },
  {
    name: "조유나",
    assignments: [
      { grade: 2, subject: "수학Ⅰ", classHours: [0, 0, 5, 5] },
      { grade: 3, subject: "미적분", classHours: [5, 0, 0, 0] },
    ],
  },
  { name: "윤재원", assignments: [{ grade: 3, subject: "미적분", classHours: [0, 5, 5, 5] }] },

  // 영어영역: 1학년 영어 → 2학년 영어Ⅰ → 3학년 영어독해와작문
  { name: "임소율", assignments: [{ grade: 1, subject: "영어", classHours: [5, 5, 5, 0] }] },
  {
    name: "한도경",
    assignments: [
      { grade: 1, subject: "영어", classHours: [0, 0, 0, 5] },
      { grade: 2, subject: "영어Ⅰ", classHours: [5, 5, 0, 0] },
    ],
  },
  {
    name: "강태양",
    assignments: [
      { grade: 2, subject: "영어Ⅰ", classHours: [0, 0, 5, 5] },
      { grade: 3, subject: "영어독해와작문", classHours: [5, 0, 0, 0] },
    ],
  },
  { name: "조수아", assignments: [{ grade: 3, subject: "영어독해와작문", classHours: [0, 5, 5, 5] }] },

  // 사회영역: 1학년 통합사회 / 2학년 한국사·사회문화 / 3학년 생활과윤리
  { name: "윤도현", assignments: [{ grade: 1, subject: "통합사회", classHours: [4, 4, 4, 4] }] },
  { name: "임서윤", assignments: [{ grade: 2, subject: "한국사", classHours: [4, 4, 4, 4] }] },
  { name: "한지호", assignments: [{ grade: 2, subject: "사회문화", classHours: [4, 4, 4, 4] }] },
  { name: "오유진", assignments: [{ grade: 3, subject: "생활과윤리", classHours: [4, 4, 4, 4] }] },

  // 과학영역: 1학년 통합과학 / 3학년 물리학Ⅰ (2학년은 과학 미배정 교육과정)
  { name: "서준혁", assignments: [{ grade: 1, subject: "통합과학", classHours: [4, 4, 4, 4] }] },
  { name: "신아윤", assignments: [{ grade: 3, subject: "물리학Ⅰ", classHours: [4, 4, 4, 4] }] },

  // 체육: 전 학년을 두 교사가 나눠 담당
  {
    name: "권지안",
    assignments: [
      { grade: 1, subject: "체육", classHours: [3, 3, 3, 3] },
      { grade: 2, subject: "체육", classHours: [3, 3, 0, 0] },
    ],
  },
  {
    name: "홍민서",
    assignments: [
      { grade: 2, subject: "체육", classHours: [0, 0, 3, 3] },
      { grade: 3, subject: "체육", classHours: [3, 3, 3, 3] },
    ],
  },

  // 음악: 두 교사가 학년을 나눠 담당
  {
    name: "오은우",
    assignments: [
      { grade: 1, subject: "음악", classHours: [2, 2, 2, 2] },
      { grade: 2, subject: "음악", classHours: [2, 2, 0, 0] },
    ],
  },
  {
    name: "장하율",
    assignments: [
      { grade: 2, subject: "음악", classHours: [0, 0, 2, 2] },
      { grade: 3, subject: "음악", classHours: [2, 2, 2, 2] },
    ],
  },

  // 미술: 전 학년을 한 교사가 전담(소규모 학교 실무 관행)
  {
    name: "서연우",
    assignments: [
      { grade: 1, subject: "미술", classHours: [2, 2, 2, 2] },
      { grade: 2, subject: "미술", classHours: [2, 2, 2, 2] },
      { grade: 3, subject: "미술", classHours: [2, 2, 2, 2] },
    ],
  },

  // 정보: 전 학년을 두 교사가 나눠 담당
  {
    name: "신다은",
    assignments: [
      { grade: 1, subject: "정보", classHours: [3, 3, 3, 3] },
      { grade: 2, subject: "정보", classHours: [2, 2, 0, 0] },
    ],
  },
  {
    name: "권민재",
    assignments: [
      { grade: 2, subject: "정보", classHours: [0, 0, 2, 2] },
      { grade: 3, subject: "정보", classHours: [2, 2, 2, 2] },
    ],
  },

  // 1학년 전용 교과
  { name: "홍시우", assignments: [{ grade: 1, subject: "기술가정", classHours: [2, 2, 2, 2] }] },

  // 진로와직업: 2·3학년을 각각 한 교사가 담당
  { name: "배지훈", assignments: [{ grade: 2, subject: "진로와직업", classHours: [3, 3, 3, 3] }] },
  { name: "문서영", assignments: [{ grade: 3, subject: "진로와직업", classHours: [3, 3, 3, 3] }] },
];

function buildDemoSubjects(): GradeSubjects {
  const raw: Partial<GradeSubjects> = {};
  for (const grade of [1, 2, 3] as const) {
    raw[grade] = DEMO_SUBJECTS_BY_GRADE[grade].map(
      (s): Subject => ({
        set: DEFAULT_SUBJECT_SET,
        name: s.name,
        units: s.units,
        classCount: DEMO_CLASS_COUNT,
      }),
    );
  }
  return sanitizeGradeSubjects(raw as GradeSubjects, createDefaultClassCounts(DEMO_CLASS_COUNT));
}

function buildDemoTeachers(): Teacher[] {
  const teachers = DEMO_TEACHERS.map((seed): Teacher => {
    const assignments = createEmptyTeacherAssignments();
    for (const a of seed.assignments) {
      assignments[a.grade] = [
        ...assignments[a.grade],
        syncAssignmentItem(a.subject, a.classHours),
      ];
    }
    return { name: seed.name, assignments };
  });
  return sanitizeTeachers(teachers);
}

type DemoTermBundle = Omit<
  TermBundle,
  "version" | "timetableName" | "academicYear" | "semester"
>;

/** SET 없는 첫 번째 예시: 학반 공통 수업만으로 구성. */
export function buildDemoTermBundleNoSet(): DemoTermBundle {
  return {
    teachers: buildDemoTeachers(),
    subjects: buildDemoSubjects(),
    daySchedule: {
      classCounts: createDefaultClassCounts(DEMO_CLASS_COUNT),
      grades: createDefaultGradeDaySchedules(),
    },
    preferences: {
      avoidLunchDouble: true,
      lunchAfterPeriod: 4,
      avoidTriplePeriod: true,
      avoidSameDaySubject: false,
      sameDaySubjectBans: [],
    },
  };
}

/**
 * SET 있는 두 번째 예시: 실제 학교에서 내보낸(export) 시간표 파일
 * ({@link demoSetExampleRaw}, `lib/demo-seed-set-example.json`)을 그대로
 * 쓴다 — 전학년 SET, 부분 SET, 교과 블록까지 모두 들어있어 SET 관련 화면을
 * 전부 체험할 수 있다. 교사/교과만 이 프로젝트의 sanitizer로 한 번 더
 * 정규화하고, 나머지(요일·선호도·SET·교과 블록·교사 제약)는 원본 그대로
 * 둔다 — 이미 이 앱에서 만들어진 유효한 데이터이기 때문이다.
 */
export function buildDemoTermBundleWithSet(): DemoTermBundle {
  const raw = demoSetExampleRaw as unknown as TermBundle;
  return {
    teachers: sanitizeTeachers(raw.teachers ?? []),
    subjects: sanitizeGradeSubjects(
      (raw.subjects ?? {}) as GradeSubjects,
      raw.daySchedule?.classCounts,
    ),
    daySchedule: raw.daySchedule,
    preferences: raw.preferences,
    setBlocks: raw.setBlocks,
    subjectBlocks: raw.subjectBlocks,
    teacherConstraints: raw.teacherConstraints,
  };
}
