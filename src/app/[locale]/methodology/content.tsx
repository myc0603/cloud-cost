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
          숨기지 않습니다. 조건을 만족하는 다른 인스턴스로 직접 바꿀 수도 있고, 바꾼 선택은 공유 링크에 함께 저장됩니다.
        </li>
        <li className={LI}>버스트 인스턴스(AWS t계열, Azure B계열, GCP E2 공유 코어)는 옵션으로 포함/제외할 수 있습니다.</li>
        <li className={LI}>스토리지 = 용량 × GB·월 단가, 트래픽 = 무료 구간을 반영한 구간별 누적 계산.</li>
      </ul>

      <h2 className={H2}>비교 기준 (공정성을 위한 통일)</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}><b>Linux 온디맨드 정가</b>(기본, 약정가는 아래), 공유 테넌시, 현세대 인스턴스만.</li>
        <li className={LI}><b>x86과 ARM</b>(AWS Graviton, Azure Dpsv6·Epsv6, GCP T2A·C4A)을 기본으로 함께 비교합니다. ARM은 대개 저렴하지만 앱 호환성 확인이 필요해 결과에 배지로 표시하며, 아키텍처 토글로 x86 또는 ARM만 볼 수 있습니다.</li>
        <li className={LI}>블록 스토리지는 3사의 <b>범용 SSD</b>끼리: AWS gp3 · GCP Balanced PD · Azure Premium SSD v2 (기본 성능 제공분 기준).</li>
        <li className={LI}>
          Kubernetes는 <b>SLA가 있는 표준 티어</b> 컨트롤 플레인끼리: EKS 기본 · AKS Standard · GKE Regional. 워커 노드는 일반 VM과
          같은 방식으로 매칭하되, 버스트 옵션과 관계없이 버스트 인스턴스는 제외합니다(꾸준히 부하가 걸리는 노드엔 CPU 크레딧 방식이 맞지 않음). AKS Free 티어(SLA 없음, 컨트롤 플레인 무료)와 GKE 결제 계정당 월 크레딧(클러스터 1개분)은 반영하지 않습니다.
        </li>
        <li className={LI}>
          로드밸런서는 <b>L7(HTTP)</b>끼리: AWS ALB · Azure Application Gateway Standard v2 · GCP 리전 외부 애플리케이션 LB. 시간당 고정비 +
          처리 트래픽 GB당 요금으로 계산합니다(AWS LCU·Azure CU는 공식 정의상 시간당 1GB). 연결 수·규칙 수가 아주 많은 서비스는 실제보다
          낮게 나올 수 있습니다.
        </li>
        <li className={LI}>
          NAT 게이트웨이는 시간당 + 처리 GB당 요금입니다. GCP Cloud NAT는 시간 요금이 VM 1대당이라 시나리오의 VM 대수와 K8s 노드 수를
          합산해 계산합니다(게이트웨이당 32대 상한). NAT 처리 요금은 아웃바운드 트래픽 요금과 별도로 더해집니다.
        </li>
        <li className={LI}>
          관리형 DB는 AWS RDS · Azure Database(Flexible Server) · GCP Cloud SQL(Enterprise)의 MySQL·PostgreSQL끼리, 요구
          vCPU·RAM을 만족하는 최저가 사이즈로 계산합니다. GCP는 커스텀 사이즈라 스펙에 맞춰 계산합니다(메모리 최소 3.75GB).
          이중화는 대기 서버를 포함한 요금입니다. Aurora·Enterprise Plus, 백업 스토리지와 추가 IOPS는 포함하지 않습니다.
        </li>
        <li className={LI}>
          캐시는 Redis 호환 관리형 캐시끼리 요구 메모리 이상인 최저가로 계산합니다: AWS ElastiCache는 <b>Valkey</b> 엔진 기준(Redis 호환,
          Redis OSS 엔진보다 약 20% 저렴한 AWS 기본 엔진), Azure는 <b>Azure Managed Redis</b>(기존 Azure Cache for Redis는 2028년 퇴역 예정),
          GCP는 Memorystore for Redis(용량 GB당 요금, 용량 구간별 단가)입니다.
        </li>
        <li className={LI}>
          캐시 이중화는 AWS 복제 노드 1개 추가, GCP Standard 등급 요금입니다. Azure Managed Redis는 가격 API가 노드 1개 요금만 제공해,
          가격 페이지의 &quot;1노드 / 2노드(이중화)&quot; 구분에 따라 <b>2배로 추정</b>했습니다.
        </li>
        <li className={LI}>
          서버리스 컨테이너는 AWS <b>ECS Fargate</b> · Azure <b>Container Apps</b>(Consumption) · GCP <b>Cloud Run</b>(CPU 상시 할당)을
          컨테이너가 24시간 실행되는 기준으로 비교합니다. 플랫폼마다 허용되는 vCPU·메모리 조합이 달라 요구 스펙 이상인 가장 싼 조합으로
          올려 계산합니다(Container Apps는 메모리 = vCPU × 2·최대 4 vCPU, Cloud Run은 vCPU 정수). Container Apps·Cloud Run은 HTTPS
          인그레스가 포함되지만 Fargate는 로드밸런서(ALB)를 별도로 더해야 합니다. 유휴 시간 할인·요청 요금(Container Apps 100만 건당
          $0.4)·월 무료 사용량은 반영하지 않습니다. ARM은 Fargate만 지원합니다.
        </li>
        <li className={LI}>
          CDN은 AWS <b>CloudFront</b> · Azure <b>Front Door Standard</b> · GCP <b>Cloud CDN</b>을 비교하며, 사용자가 리전과 같은
          지역(서울이면 한국·아시아태평양, 미국 동부면 북미)에 있다고 가정합니다. 전송 GB·요청 수 구간 요금에 Front Door 기본료(월 $35)를
          더하고, GCP는 캐시 채움 요금을 캐시 적중률 90% 가정으로 더합니다. CloudFront는 사용량을 감당하는 가장 싼{' '}
          <b>정액 요금제</b>(Free·Pro·Business·Premium)와 종량제 중 싼 쪽으로 계산합니다. CDN을 거친 트래픽은 아웃바운드 트래픽 카드와
          별개이고, AWS·Azure 오리진에서 CDN으로 가는 전송은 무료입니다. Cloud CDN이 쓰는 L7 로드밸런서 요금은 로드밸런서 카드로 따로
          더합니다.
        </li>
        <li className={LI}>
          로그 수집은 3사의 <b>표준(검색·분석 가능) 등급</b>끼리 비교합니다: AWS CloudWatch Logs Standard · Azure Log Analytics Analytics
          Logs · GCP Cloud Logging. 수집 GB당 요금 + 보관 기간 동안 쌓인 양의 보관 요금이며, Azure는 31일·GCP는 30일 보관이 기본 포함이고
          AWS는 압축 크기(원본의 15%, 공식 가정)로 처음부터 과금합니다. Azure는 하루 약정량이 있는 Commitment Tier가 더 싸면 그걸로
          계산합니다. 쿼리 요금, 저가 등급(CloudWatch Infrequent Access · Azure Basic·Auxiliary Logs), 벤더 로그(VPC 플로우 로그 등)는
          포함하지 않습니다.
        </li>
        <li className={LI}>
          <b>약정 할인</b>(요금 기준: 1년·3년 약정)은 3사 모두 <b>인스턴스 고정형 + 선결제 없음</b> 기준입니다: AWS EC2 Instance Savings
          Plans(Standard RI와 같은 요율)·RDS/ElastiCache 예약 인스턴스, Azure 예약(월납·선납 총액 동일), GCP 리소스 기반 약정 사용
          할인(CUD, 월납). 더 유연한 상품(AWS Compute Savings Plans·Azure Savings Plan)은 할인 폭이 작아 쓰지 않습니다. 단, 서버리스
          컨테이너는 고정형 약정이 없어 각 사의 유일한 약정(Fargate Compute Savings Plans·Container Apps Savings Plan·Cloud Run 유연
          CUD 1년 28%·3년 46%)을 적용합니다. 약정가 기준으로
          최저가 인스턴스를 다시 찾으며, 약정 상품이 없는 SKU는 정가로 계산하고 &quot;약정가 없음&quot;으로 표시합니다.
        </li>
        <li className={LI}>
          약정은 VM·K8s 노드·DB·캐시·컨테이너 컴퓨트에만 적용되고 스토리지·트래픽·CDN·로그·LB·NAT·K8s 컨트롤 플레인은 정가입니다. RDS 3년처럼 선결제 없음
          상품이 없으면 부분 선결제액을 기간 시간으로 나눠 시간당에 더합니다. GCP Cloud SQL(1년 25%·3년 52%)과 Memorystore(1년 20%·3년
          40%, 5GB 이상)는 지출 기반 약정이라 가격 API에 약정가가 없어 공식 문서의 할인율을 씁니다. Azure DB 이중화의 약정가는 대기 서버
          vCore까지 예약한다고 보고 2배로 계산합니다.
        </li>
        <li className={LI}>
          <b>무료 사용량</b>: 계정당 한 번 주어지는 상시 무료분(CloudFront 종량제 월 1TB, Container Apps·Cloud Run 월 무료분, GKE 월
          크레딧, AKS Free 티어 등)은 반영하지 않습니다. 실제 계정에선 다른 서비스가 이미 쓰고 있을 수 있어 구성 하나만 놓고 빼면 실제보다
          싸게 나오기 때문입니다. 단, 요금표 자체에 들어 있는 트래픽 무료 구간과, 배포마다 고르는 정식 요금제(CloudFront Free 요금제)는
          반영합니다.
        </li>
        <li className={LI}>
          GCP N1·N2·N2D·C2는 한 달 내내 쓰면 <b>지속 사용 할인</b>(최대 20~30%)이 자동으로 붙지만 정가 견적에는 반영하지 않습니다.
          해당 인스턴스가 선택되면 결과에 표시합니다. 기본 매칭되는 E2 등 신형 시리즈는 대상이 아닙니다.
        </li>
        <li className={LI}>공인 IP 주소 시간 요금(3사 모두 시간당 약 $0.005)은 포함하지 않습니다.</li>
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
        <li className={LI}>Azure·GCP는 가격 API에 스펙이 없어 주력 시리즈만 수록합니다 (Azure: B·Bsv2/Dsv5·Dsv6/Esv5·Esv6/Fsv2/Dpsv6·Epsv6, GCP: E2/N1/N2/N2D/N4/N4D/C2/C2D/C3/C3D/C4/C4D/T2D/T2A/C4A). Azure AMD 변형(Dasv6 등) 등 일부 시리즈는 빠져 있어 실제 최저가와 다를 수 있습니다.</li>
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
          never hide what the comparison is based on. You can also switch to any other instance that meets
          the specs, and your choice is saved in the share link.
        </li>
        <li className={LI}>Burstable instances (AWS t-series, Azure B-series, GCP E2 shared-core) can be included or excluded as an option.</li>
        <li className={LI}>Storage = capacity × GB-month rate; traffic = cumulative tiered calculation with free allowances applied.</li>
      </ul>

      <h2 className={H2}>Comparison basis (unified for fairness)</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}><b>Linux on-demand list prices</b> (by default — commitment prices below), shared tenancy, current-generation instances only.</li>
        <li className={LI}><b>x86 and ARM</b> (AWS Graviton, Azure Dpsv6·Epsv6, GCP T2A·C4A) are compared together by default. ARM is usually cheaper but needs app compatibility, so it is marked with a badge, and the architecture toggle lets you limit results to x86 or ARM.</li>
        <li className={LI}>Block storage compares the three general-purpose SSDs: AWS gp3 · GCP Balanced PD · Azure Premium SSD v2 (baseline performance included in the price).</li>
        <li className={LI}>
          Kubernetes compares <b>SLA-backed standard-tier</b> control planes: EKS standard · AKS Standard · GKE Regional. Worker nodes
          are matched the same way as regular VMs, except that burstable instances are always excluded regardless of the burstable option (CPU credits don't suit nodes under sustained load). The AKS Free tier (no SLA, free control plane) and GKE&apos;s monthly per-billing-account
          credit (one cluster) are not applied.
        </li>
        <li className={LI}>
          Load balancers compare <b>L7 (HTTP)</b> offerings: AWS ALB · Azure Application Gateway Standard v2 · GCP regional external
          Application LB. Cost = hourly fixed fee + per-GB processed (AWS LCU and Azure CU are officially defined as 1 GB per hour).
          Services with very high connection or rule counts may be underestimated.
        </li>
        <li className={LI}>
          NAT gateways are hourly + per-GB processed. GCP Cloud NAT bills hourly per VM, so we count the VMs and K8s nodes in your
          scenario (capped at 32 per gateway). NAT processing is charged in addition to outbound traffic.
        </li>
        <li className={LI}>
          Managed databases compare MySQL and PostgreSQL on AWS RDS · Azure Database (Flexible Server) · GCP Cloud SQL (Enterprise),
          picking the cheapest size that meets the requested vCPU and RAM. GCP uses custom sizes fitted to the spec (minimum 3.75 GB
          memory). High availability includes the standby. Aurora, Enterprise Plus, backup storage and extra IOPS are not included.
        </li>
        <li className={LI}>
          Caches compare Redis-compatible managed caches, picking the cheapest option with at least the requested memory: AWS ElastiCache
          with the <b>Valkey</b> engine (Redis-compatible and about 20% cheaper than the Redis OSS engine — AWS&apos;s default), Azure
          <b> Azure Managed Redis</b> (the older Azure Cache for Redis is retiring in 2028), and GCP Memorystore for Redis (priced per GB
          with capacity-tier rates).
        </li>
        <li className={LI}>
          Cache high availability means one extra replica node on AWS and the Standard tier on GCP. For Azure Managed Redis the pricing
          API only lists the single-node price, so we <b>estimate HA at 2×</b> based on the pricing page&apos;s one-node / two-node (HA) split.
        </li>
        <li className={LI}>
          Serverless containers compare AWS <b>ECS Fargate</b> · Azure <b>Container Apps</b> (Consumption) · GCP <b>Cloud Run</b> (CPU
          always allocated) running 24/7. Each platform allows different vCPU/memory combinations, so we round up to the cheapest allowed
          combination that meets the spec (Container Apps: memory = vCPU × 2, up to 4 vCPU; Cloud Run: whole vCPUs). Container Apps and
          Cloud Run include HTTPS ingress, while Fargate needs a separate load balancer (ALB). Idle-time discounts, request charges
          (Container Apps $0.4 per million) and monthly free grants are not included. Only Fargate offers ARM.
        </li>
        <li className={LI}>
          CDNs compare AWS <b>CloudFront</b> · Azure <b>Front Door Standard</b> · GCP <b>Cloud CDN</b>, assuming your users are in the
          same area as the region (Seoul → Korea/Asia Pacific, US East → North America). We add tiered per-GB and per-request rates,
          Front Door&apos;s base fee ($35/month), and GCP cache fill assuming a 90% cache hit ratio. CloudFront uses whichever is cheaper:
          pay-as-you-go or the cheapest <b>flat-rate plan</b> (Free, Pro, Business, Premium) whose allowance covers your usage. CDN traffic
          is separate from the outbound traffic card, and transfer from AWS or Azure origins to the CDN is free. The L7 load balancer that
          Cloud CDN needs is added with the load balancer card.
        </li>
        <li className={LI}>
          Log ingestion compares the <b>standard (searchable) tiers</b>: AWS CloudWatch Logs Standard · Azure Log Analytics Analytics Logs
          · GCP Cloud Logging. Cost = per-GB ingestion + storage for what accumulates over the retention period; Azure includes 31 days
          and GCP 30 days, while AWS bills compressed size (15% of raw, its published assumption) from day one. On Azure we use a
          commitment tier when it is cheaper. Query charges, lower-cost tiers (CloudWatch Infrequent Access, Azure Basic/Auxiliary Logs)
          and vended logs (VPC flow logs, etc.) are not included.
        </li>
        <li className={LI}>
          <b>Commitment discounts</b> (Pricing: 1-year or 3-year commitment) use <b>instance-specific commitments with no upfront
          payment</b> on all three: AWS EC2 Instance Savings Plans (same rates as Standard RIs) and RDS/ElastiCache reserved instances,
          Azure reservations (monthly and upfront totals are equal), and GCP resource-based committed use discounts (CUDs, billed
          monthly). More flexible plans (AWS Compute Savings Plans, Azure savings plan) give smaller discounts and are not used, except
          for serverless containers, which have no instance-specific commitments — there we use each provider&apos;s only option
          (Fargate Compute Savings Plans, Container Apps savings plan, Cloud Run flexible CUDs at 28% / 46%). The
          cheapest instance is re-matched at commitment prices; SKUs without a commitment offer are priced on-demand and marked
          &quot;no commitment price&quot;.
        </li>
        <li className={LI}>
          Commitments apply only to VM, K8s node, DB, cache and container compute; storage, traffic, CDN, logs, load balancers, NAT and K8s control planes
          stay on-demand. Where no no-upfront option exists (some 3-year RDS terms), the partial upfront payment is spread over the
          term&apos;s hours. GCP Cloud SQL (25% for 1 year, 52% for 3 years) and Memorystore (20% / 40%, instances of 5 GB or more) use
          spend-based commitments with no commitment prices in the pricing API, so we apply the discount rates from the official docs.
          Azure DB high-availability commitment prices assume the standby&apos;s vCores are reserved too (2×).
        </li>
        <li className={LI}>
          <b>Free usage</b>: per-account always-free allowances (CloudFront pay-as-you-go 1 TB/month, Container Apps and Cloud Run monthly
          grants, the GKE monthly credit, the AKS Free tier, etc.) are not applied — a real account may already be using them for other
          services, so subtracting them for one setup would understate the cost. Free tiers built into the rate tables (traffic) and
          standalone plans you pick per deployment (the CloudFront Free plan) are included.
        </li>
        <li className={LI}>
          GCP N1, N2, N2D and C2 automatically get a <b>sustained use discount</b> (up to 20–30%) when run for the whole month, but
          on-demand estimates don&apos;t include it; the result notes it when such an instance is selected. Newer series such as E2
          (the usual default match) are not eligible.
        </li>
        <li className={LI}>Public IP address hourly fees (about $0.005/hour on all three) are not included.</li>
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
        <li className={LI}>Azure and GCP pricing APIs carry no specs, so only main series are cataloged (Azure: B·Bsv2/Dsv5·Dsv6/Esv5·Esv6/Fsv2/Dpsv6·Epsv6; GCP: E2/N1/N2/N2D/N4/N4D/C2/C2D/C3/C3D/C4/C4D/T2D/T2A/C4A). Some series such as Azure AMD variants (Dasv6, etc.) are not included, so the true cheapest option may differ.</li>
        <li className={LI}>These estimates are meant for <b>structural comparison and ballparking</b>, not as a basis for contracts or billing.</li>
      </ul>
    </>
  );
}
