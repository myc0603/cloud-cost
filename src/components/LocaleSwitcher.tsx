'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { getPathname, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LOCALE_LABEL: Record<string, string> = { en: 'EN', ko: '한국어' };

function SwitcherInner() {
  const locale = useLocale();
  const pathname = usePathname();
  // 시나리오가 쿼리스트링에 있으므로 언어 전환 시 보존한다
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams.entries());

  return (
    <div className="flex items-center gap-2 text-xs">
      {routing.locales.map((l) =>
        l === locale ? (
          <span key={l} className="font-semibold text-slate-900">{LOCALE_LABEL[l]}</span>
        ) : (
          // 일부러 클라이언트 라우팅(Link) 대신 일반 앵커를 쓴다:
          // 기본 언어(/)로의 전환은 프리페치가 언어 감지 리다이렉트(/→/ko)를
          // 캐시해 되돌아가는 문제가 있어, 쿠키 갱신 후 전체 로드로 우회한다
          <a
            key={l}
            href={getPathname({ href: { pathname, query }, locale: l })}
            className="text-slate-400 hover:text-slate-900"
            onClick={() => {
              document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
            }}
          >
            {LOCALE_LABEL[l]}
          </a>
        ),
      )}
    </div>
  );
}

export default function LocaleSwitcher() {
  // useSearchParams는 정적 렌더 페이지에서 Suspense 경계가 필요하다
  return (
    <Suspense>
      <SwitcherInner />
    </Suspense>
  );
}
