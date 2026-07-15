import type { Meta } from '@/lib/schema';

// 장문 문서라 메시지 키 대신 로케일별 JSX로 관리한다 (마크업 유지가 쉬움)
const H2 = 'mt-8 mb-2 text-lg font-bold';
const P = 'text-sm leading-6 text-slate-700';
const LI = 'text-sm leading-6 text-slate-700';

export function MethodologyKo({ meta }: { meta: Meta | null }) {
  return (
    <>
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
    </>
  );
}

export function MethodologyEn({ meta }: { meta: Meta | null }) {
  return (
    <>
      <h2 className={H2}>Data sources</h2>
      <p className={P}>All prices are collected from each cloud&rsquo;s official pricing API. Nothing is entered by hand.</p>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>AWS — Price List Bulk API (per-region offer files)</li>
        <li className={LI}>Azure — Retail Prices API</li>
        <li className={LI}>GCP — Cloud Billing Catalog API</li>
        <li className={LI}>Exchange rate (USD→KRW) — for display only, refreshed daily{meta?.usdKrw ? ` (currently $1 = ₩${meta.usdKrw.rate.toLocaleString()})` : ''}</li>
      </ul>

      <h2 className={H2}>Collection and validation</h2>
      <p className={P}>
        Prices are collected automatically once a day. If a run looks abnormal compared to the previous
        day (many prices swinging ±30%, a sharp drop in item count), we treat it as a collector error and
        hold the update — a safeguard against showing corrupted data. The &ldquo;prices collected&rdquo;
        date on screen is the last healthy collection.
      </p>

      <h2 className={H2}>How estimates are computed</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>Monthly cost = hourly price × <b>730 hours</b> (the convention shared by all three official calculators)</li>
        <li className={LI}>
          VM auto-matching: we pick the <b>cheapest instance that satisfies both</b> the requested vCPU
          and RAM (ties go to fewer vCPUs). The selected instance is always shown in the estimate — we
          never hide what the comparison is based on.
        </li>
        <li className={LI}>Burstable instances (AWS t-series, Azure B-series, GCP E2 shared-core) can be included or excluded as an option.</li>
        <li className={LI}>Storage = capacity × GB-month rate; traffic = cumulative tiered calculation with free allowances applied.</li>
      </ul>

      <h2 className={H2}>Comparison basis (unified for fairness)</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}><b>Linux on-demand list prices</b>, shared tenancy, current-generation instances only.</li>
        <li className={LI}><b>x86 only</b> (ARM — AWS Graviton, GCP T2A — excluded: comparing identical specs across architectures would not be fair).</li>
        <li className={LI}>Block storage compares the three general-purpose SSDs: AWS gp3 · GCP Balanced PD · Azure Premium SSD v2 (baseline performance included in the price).</li>
        <li className={LI}>Object storage uses the standard tier, first pricing band (up to 50TB).</li>
        <li className={LI}>
          Outbound traffic is unified on <b>internet routing</b> across all three: GCP Standard network
          tier, Azure Routing Preference: Internet, AWS default. (GCP&rsquo;s Premium tier prices depend
          on the destination, so a single comparison is not possible.)
        </li>
      </ul>

      <h2 className={H2}>Limitations — what this estimate does not tell you</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>Commitment discounts (Savings Plans, CUD, RI), free tiers, and negotiated discounts are not reflected — your actual bill may be lower.</li>
        <li className={LI}>Extra storage IOPS, API request counts, snapshots, load balancers, and other add-on charges are not included.</li>
        <li className={LI}>Azure coverage is limited to four main series (B/Dsv5/Esv5/Fsv2), so matching options may be narrower.</li>
        <li className={LI}>These estimates are meant for <b>structural comparison and ballparking</b>, not as a basis for contracts or billing.</li>
      </ul>
    </>
  );
}
