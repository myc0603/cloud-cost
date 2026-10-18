'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

const LINKS = [
  { href: '/', key: 'scenario' },
  { href: '/instances', key: 'instances' },
  { href: '/methodology', key: 'methodology' },
] as const;

type Bar = { left: number; top: number; width: number };

/** 나브바 메뉴 — 지금 페이지는 진하게 + 나브바 아랫선에 붙는 밑줄. 페이지를 옮기면 밑줄이 미끄러져 간다 */
export default function NavLinks() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const boxRef = useRef<HTMLDivElement>(null);
  // 밑줄 위치 — 재기 전(서버 HTML·하이드레이션 직후)엔 null이고 그동안은 링크 자체 테두리로 그린다
  const [bar, setBar] = useState<Bar | null>(null);
  // 처음 자리 잡을 땐 미끄러지지 않게, 그 다음 이동부터 애니메이션
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = boxRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      setBar(el ? { left: el.offsetLeft, top: el.offsetTop + el.offsetHeight - 2, width: el.offsetWidth } : null);
    };
    measure();
    // 폰트 로딩·창 크기 변경(모바일 줄바꿈)으로 링크 폭·위치가 바뀌면 다시 잰다
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [pathname]);

  useLayoutEffect(() => {
    if (bar && !animate) requestAnimationFrame(() => setAnimate(true));
  }, [bar, animate]);

  // self-stretch: 줄 높이(브랜드 아이콘)만큼 늘려야 링크 아래끝 = 나브바 아랫선
  return (
    <div ref={boxRef} className="relative order-last flex w-full gap-5 self-stretch whitespace-nowrap sm:order-none sm:w-auto sm:gap-6">
      {LINKS.map(({ href, key }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-3 flex items-center border-b-2 pb-2.5 ${active && !bar ? 'border-slate-900 dark:border-slate-100' : 'border-transparent'} ${
              active
                ? 'font-semibold text-slate-900 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {t(key)}
          </Link>
        );
      })}
      {bar && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 h-0.5 bg-slate-900 dark:bg-slate-100 ${
            animate ? 'transition-[translate,width] duration-300 ease-out motion-reduce:transition-none' : ''
          }`}
          style={{ top: bar.top, width: bar.width, translate: `${bar.left}px 0` }}
        />
      )}
    </div>
  );
}
