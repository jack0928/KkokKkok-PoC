"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navigation() {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "홈" },
    { href: "/feature-discovery", label: "이미지 분석" },
    { href: "/results", label: "결과·사람 검토" },
    { href: "/detection-evaluation", label: "실험 2 · 예정" },
  ];
  return <nav aria-label="주 메뉴">{links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href || (link.href === "/results" && pathname.startsWith("/review/")) ? "page" : undefined}>{link.label}</Link>)}</nav>;
}
