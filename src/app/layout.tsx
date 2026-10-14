import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Navigation } from "@/components/navigation";

export const metadata: Metadata = {
  title: "꼭꼭 · Location Cue Lab",
  description: "중앙대학교 캡스톤 꼭꼭의 Location Cue Detection 실험용 PoC",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main">본문으로 이동</a>
        <header className="site-header">
          <div className="header-inner">
            <Link className="brand" href="/" aria-label="꼭꼭 홈"><span>꼭꼭 <small>Location Cue Lab</small></span></Link>
            <Navigation />
          </div>
        </header>
        <main id="main" className="main-container">{children}</main>
        <footer className="site-footer"><span>중앙대학교 캡스톤 프로젝트 · 꼭꼭</span><span>단서를 탐색하고, 사람이 판단합니다.</span></footer>
      </body>
    </html>
  );
}
