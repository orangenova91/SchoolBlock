export default function PrivacyPolicyPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12">
      <main className="flex w-full max-w-3xl flex-col gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            개인정보처리방침
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            시행일자: 2026년 9월 1일
          </p>
        </header>

        <div className="flex flex-col gap-8 rounded-2xl border border-zinc-200 bg-white p-6 text-sm leading-relaxed text-zinc-700 shadow-sm sm:p-8">
          <p>
            스쿨블럭(SchoolBlock, 이하 &ldquo;서비스&rdquo;)은 이용자의 개인정보를
            소중히 여기며, 「개인정보 보호법」 등 관련 법령을 준수합니다. 이
            방침은 서비스가 어떤 정보를 왜 수집하고, 어떻게 보관·이용·파기하는지
            설명합니다.
          </p>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              1. 수집하는 개인정보 항목 및 수집 방법
            </h2>
            <p>서비스는 아래 정보를 이용자가 직접 입력하는 과정에서 수집합니다.</p>
            <ul className="list-inside list-disc space-y-1">
              <li>계정 정보: 아이디(학교명), 비밀번호(암호화 저장)</li>
              <li>
                시간표 작성 정보: 교사 성명, 담당 교과·학반·시수, 학반·교과·요일
                설정, 생성된 시간표 결과 등 이용자가 입력하는 학사 정보
              </li>
              <li>
                자동 수집 정보: 로그인 세션 유지를 위한 쿠키, 접속 시각 등
                서비스 운영 과정에서 서버에 기록되는 정보
              </li>
            </ul>
            <p>
              별도 계정 발급을 신청하실 때는 서비스 밖의 구글 설문(Google
              Forms)을 이용하며, 그 정보는 구글의 개인정보 처리방침을
              따릅니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              2. 개인정보의 수집 및 이용 목적
            </h2>
            <ul className="list-inside list-disc space-y-1">
              <li>계정 식별 및 로그인 유지</li>
              <li>학교별 시간표 작성·저장·자동 생성 기능 제공</li>
              <li>서비스 문의 응대 및 오류 대응</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              3. 개인정보의 보유 및 이용 기간
            </h2>
            <ul className="list-inside list-disc space-y-1">
              <li>
                일반 계정: 이용자가 직접 삭제하거나 삭제를 요청하기 전까지
                보유합니다. 학기(시간표) 삭제 시 그에 딸린 교과·교사·시간표
                데이터는 즉시 함께 삭제됩니다.
              </li>
              <li>
                체험(데모) 계정: &ldquo;체험해보기&rdquo;로 만들어진 계정과
                예시 데이터는 생성 후 2시간이 지나면 자동으로 삭제됩니다.
              </li>
              <li>로그인 세션 쿠키: 최대 30일간 보관되며, 로그아웃 시 즉시 삭제됩니다.</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              4. 개인정보의 제3자 제공
            </h2>
            <p>
              서비스는 이용자의 개인정보를 외부에 제공하지 않습니다. 다만
              법령에 근거가 있거나 이용자가 별도로 동의한 경우는 예외로
              합니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              5. 개인정보 처리의 위탁
            </h2>
            <p>서비스는 안정적인 운영을 위해 아래와 같이 업무를 위탁합니다.</p>
            <ul className="list-inside list-disc space-y-1">
              <li>수탁업체: MongoDB, Inc. (MongoDB Atlas)</li>
              <li>위탁업무: 데이터베이스 호스팅 및 저장</li>
              <li>데이터 보관 위치: 서울 리전(Seoul, ap-northeast-2)</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              6. 쿠키(Cookie)의 운영
            </h2>
            <p>
              서비스는 로그인 상태 유지를 위해 세션 쿠키를 사용합니다. 이
              쿠키는 서버만 읽을 수 있도록 설정되어 있으며(HttpOnly),
              브라우저 설정에서 쿠키 저장을 거부할 수 있으나 이 경우
              로그인이 유지되지 않아 서비스 이용에 제약이 있을 수 있습니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              7. 정보주체의 권리와 행사 방법
            </h2>
            <p>
              이용자는 언제든지 본인의 계정 정보와 시간표 데이터에 대한
              열람·정정·삭제를 요청할 수 있습니다. 아래 문의 채널로 연락해
              주시면 확인 후 조치합니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              8. 개인정보의 안전성 확보 조치
            </h2>
            <ul className="list-inside list-disc space-y-1">
              <li>비밀번호는 복호화할 수 없는 방식(해시)으로 암호화하여 저장합니다.</li>
              <li>계정별로 본인 소유의 데이터만 조회·수정할 수 있도록 접근을 제한합니다.</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              9. 개인정보 보호 책임자 및 문의처
            </h2>
            <p>
              개인정보 관련 문의는 아래 채널로 접수해 주세요.
              <br />
              담당자: 박성현 · 이메일:{" "}
              <a
                href="mailto:Orangenova91@gmail.com"
                className="font-medium text-zinc-900 underline underline-offset-2"
              >
                Orangenova91@gmail.com
              </a>
              <br />
              카카오톡 문의:{" "}
              <a
                href="https://open.kakao.com/o/ghpSxzIh"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-2"
              >
                open.kakao.com/o/ghpSxzIh
              </a>
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-zinc-900">
              10. 고지의 의무
            </h2>
            <p>
              이 방침의 내용이 변경되는 경우 서비스 내 공지를 통해
              고지합니다.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
