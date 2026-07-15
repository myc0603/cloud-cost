import type { Meta } from '@/lib/schema';

/** "가격 기준: ○○ 수집" 배지 — 신뢰 장치. 서버 컴포넌트(빌드 시점 렌더) */
export default function DataFreshness({ meta }: { meta: Meta | null }) {
  if (!meta) return null;
  const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(
    new Date(meta.collectedAt),
  );
  return (
    <p className="mt-2 text-xs text-slate-400">
      가격 기준: {date} 수집 · <a href="/methodology" className="underline hover:text-slate-600">산정 방식</a>
    </p>
  );
}
