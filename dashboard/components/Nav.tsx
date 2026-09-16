'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Live' },
  { href: '/signals', label: 'Nhật ký signal' },
  { href: '/stats', label: 'Thống kê' },
  { href: '/health', label: 'Sức khoẻ' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="brand">scalping<span>-lab</span></div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? 'on' : ''}>
          {l.label}
        </Link>
      ))}
      {/* Nhac lien tuc rang buoc cung #7. Khong bao gio de nguoi dung nham tuong
          he thong dang vao lenh that. */}
      <div className="shadow">SHADOW · lệnh mô phỏng</div>
    </nav>
  );
}
