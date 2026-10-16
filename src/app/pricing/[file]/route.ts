/**
 * 리전별 요금 스냅샷 — 빌드 시 /pricing/{region}.json 정적 파일로 만든다 (데이터 갱신 = 재빌드, 기존과 동일).
 * 화면은 고른 리전만 받아온다 — 페이지에 전 리전을 넣으면 리전 수만큼 첫 로딩이 커진다.
 * 경로에 점(.)이 있어 로케일 미들웨어(proxy.ts)를 타지 않는다.
 */

import { loadPricing } from '@/lib/pricing';
import { REGIONS } from '@/lib/regions';
import type { Region } from '@/lib/schema';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return REGIONS.map((region) => ({ file: `${region}.json` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  return Response.json(loadPricing(file.replace(/\.json$/, '') as Region));
}
