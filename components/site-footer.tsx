import Link from "next/link";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-200 bg-white px-4 py-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 text-xs text-zinc-500 sm:flex-row">
        <p>
          © {year} 스쿨블럭(SchoolBlock) · 개발 스쿨허브(SchoolHub)
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="transition hover:text-zinc-900 hover:underline hover:underline-offset-2"
          >
            개인정보처리방침
          </Link>
          <a
            href="https://open.kakao.com/o/ghpSxzIh"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-zinc-900 hover:underline hover:underline-offset-2"
          >
            문의하기
          </a>
          <a
            href="mailto:Orangenova91@gmail.com"
            className="transition hover:text-zinc-900 hover:underline hover:underline-offset-2"
          >
            Orangenova91@gmail.com
          </a>
        </div>
      </div>
    </footer>
  );
}
