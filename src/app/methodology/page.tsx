import type { Metadata } from 'next';
import DataFreshness from '@/components/DataFreshness';
import { loadMeta } from '@/lib/pricing';

export const metadata: Metadata = {
  title: '데이터 출처와 산정 방식 | 클라우드 비용 비교',
  description:
    '가격 데이터의 출처(3사 공식 API), 수집 주기, 견적 계산 방식, 비교 기준과 한계를 투명하게 공개합니다.',
};

const H2 = 'mt-8 mb-2 text-lg font-bold';
const P = 'text-sm leading-6 text-slate-700';
const LI = 'text-sm leading-6 text-slate-700';

export default function MethodologyPage() {
  const meta = loadMeta();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold">데이터 출처와 산정 방식</h1>
        <DataFreshness meta={meta} />
      </header>

      <h2 className={H2}>데이터 출처</h2>
      <p className={P}>모든 가격은 각 클라우드의 공식 가격 API에서 수집합니다. 사람이 손으로 입력하지 않습니다.</p>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>AWS — Price List Bulk API (리전별 오퍼 파일)</li>
        <li className={LI}>Azure — Retail Prices API</li>
        <li className={LI}>GCP — Cloud Billing Catalog API</li>
        <li className={LI}>환율(USD→KRW) — 표시 참고용, 일 1회 갱신{meta?.usdKrw ? ` (현재 $1 = ₩${meta.usdKrw.rate.toLocaleString()})` : ''}</li>
      </ul>

      <h2 className={H2}>수집과 검증</h2>
      <p className={P}>
        매일 1회 자동 수집합니다. 수집 결과가 전일 대비 비정상적으로 다르면(가격 ±30% 급변 다수,
        항목 수 급감 등) 수집기 오류로 간주하고 갱신을 보류합니다 — 오염된 데이터가 표시되는 것을
        막기 위한 안전장치입니다. 화면의 &ldquo;가격 기준&rdquo; 날짜가 마지막 정상 수집 시각입니다.
      </p>

      <h2 className={H2}>견적 계산 방식</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>월 비용 = 시간당 가격 × <b>730시간</b> (3사 계산기 공통 관례)</li>
        <li className={LI}>
          VM 자동 매칭: 요구 vCPU·RAM을 <b>모두 만족하는 인스턴스 중 최저가</b>를 선택합니다 (동가면
          vCPU가 작은 것). 선택된 인스턴스는 항상 견적 화면에 표시합니다 — 어떤 근거로 비교했는지
          숨기지 않습니다.
        </li>
        <li className={LI}>버스트 인스턴스(AWS t계열, Azure B계열, GCP E2 공유 코어)는 옵션으로 포함/제외할 수 있습니다.</li>
        <li className={LI}>스토리지 = 용량 × GB·월 단가, 트래픽 = 무료 구간을 반영한 구간별 누적 계산.</li>
      </ul>

      <h2 className={H2}>비교 기준 (공정성을 위한 통일)</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}><b>Linux 온디맨드 정가</b>, 공유 테넌시, 현세대 인스턴스만.</li>
        <li className={LI}><b>x86 아키텍처만</b> 비교합니다 (ARM — AWS Graviton, GCP T2A — 제외. 아키텍처가 다르면 동일 스펙 비교가 공정하지 않습니다).</li>
        <li className={LI}>블록 스토리지는 3사의 <b>범용 SSD</b>끼리: AWS gp3 · GCP Balanced PD · Azure Premium SSD v2 (기본 성능 제공분 기준).</li>
        <li className={LI}>오브젝트 스토리지는 표준 티어 첫 구간(50TB 이하) 단가.</li>
        <li className={LI}>
          아웃바운드 트래픽은 3사 모두 <b>인터넷 라우팅 기준</b>으로 통일: GCP Standard 네트워크 티어,
          Azure Routing Preference: Internet, AWS 기본. (GCP Premium 티어는 목적지별 요금이라 단일
          비교가 불가능합니다.)
        </li>
      </ul>

      <h2 className={H2}>한계 — 이 견적이 말해주지 않는 것</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>약정 할인(Savings Plans, CUD, RI), 프리티어, 협상 할인 미반영 — 실제 청구액은 더 낮을 수 있습니다.</li>
        <li className={LI}>스토리지 IOPS 추가분, API 요청 수, 스냅샷, 로드밸런서 등 부가 요금 미포함.</li>
        <li className={LI}>Azure는 주력 4개 시리즈(B/Dsv5/Esv5/Fsv2)만 수록되어 있어 매칭 폭이 좁을 수 있습니다.</li>
        <li className={LI}>이 서비스의 견적은 <b>구조 비교와 규모 감 잡기</b>를 위한 것이며, 계약·정산의 근거 자료가 아닙니다.</li>
      </ul>
    </main>
  );
}
