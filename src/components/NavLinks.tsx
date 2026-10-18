'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

const LINKS = [
  { href: '/', key: 'scenario' },
  { href: '/instances', key: 'instances' },
  { href: '/methodology', key: 'methodology' },
] as const;

/** 나브바 메뉴 — 지금 페이지는 진하게 + 나브바 아랫선에 붙는 밑줄 */
export default function NavLinks() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <div className="order-last flex w-full gap-5 whitespace-nowrap sm:order-none sm:w-auto sm:gap-6">
      {LINKS.map(({ href, key }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-3 border-b-2 pb-2.5 ${
              active
                ? 'border-slate-900 dark:border-slate-100 font-semibold text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {t(key)}
          </Link>
        );
      })}
    </div>
  );
}
