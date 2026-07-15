import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Meta } from '@/lib/schema';

/** "가격 기준: ○○ 수집" 배지 — 신뢰 장치. 서버 컴포넌트(빌드 시점 렌더) */
export default function DataFreshness({ meta }: { meta: Meta | null }) {
  const locale = useLocale();
  const t = useTranslations('freshness');
  if (!meta) return null;
  const date = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'long',
    timeZone: 'Asia/Seoul',
  }).format(new Date(meta.collectedAt));
  return (
    <p className="mt-2 text-xs text-slate-400">
      {t('collected', { date })} ·{' '}
      <Link href="/methodology" className="underline hover:text-slate-600">{t('methodology')}</Link>
    </p>
  );
}
