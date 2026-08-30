export const SCHOOL_SIDOS = [
  "강원특별자치도",
  "경기도",
  "경상남도",
  "경상북도",
  "광주광역시",
  "대구광역시",
  "대전광역시",
  "부산광역시",
  "서울특별시",
  "세종특별자치시",
  "울산광역시",
  "인천광역시",
  "재외한국학교",
  "전라남도",
  "전라북도",
  "전북특별자치도",
  "제주특별자치도",
  "충청남도",
  "충청북도",
] as const;

export const MANUAL_SCHOOL_TYPES = [
  "초등학교",
  "중학교",
  "고등학교",
  "특수학교",
  "기타",
] as const;

export type SchoolSido = (typeof SCHOOL_SIDOS)[number];
export type ManualSchoolType = (typeof MANUAL_SCHOOL_TYPES)[number];
