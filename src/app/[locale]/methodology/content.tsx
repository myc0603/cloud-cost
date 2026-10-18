import type { Meta } from '@/lib/schema';

// 장문 문서라 메시지 키 대신 로케일별 JSX로 관리한다 (마크업 유지가 쉬움)
const H2 = 'mt-8 mb-2 text-lg font-bold';
const P = 'break-words text-sm leading-6 text-slate-700';
const LI = 'break-words text-sm leading-6 text-slate-700';

export function MethodologyKo({ meta }: { meta: Meta | null }) {
  return (
    <>
      <h2 className={H2}>데이터 출처</h2>
      <p className={P}>
        가격은 각 클라우드의 공식 가격 API에서 자동 수집합니다. API에 없는 일부 값(Azure·GCP 인스턴스 스펙, CloudFront 정액 요금제,
        Cloud SQL·Memorystore·Cloud Run 약정 할인율, Cloud CDN 캐시 채움 단가 등)은 공식 문서값을 확인 날짜와 함께 코드에 기록해 씁니다.
      </p>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>AWS — Price List Bulk API (리전별 오퍼 파일)</li>
        <li className={LI}>Azure — Retail Prices API</li>
        <li className={LI}>GCP — Cloud Billing Catalog API</li>
        <li className={LI}>OCI — 가격 목록 API (전 품목, 리전과 무관한 단일가)</li>
        <li className={LI}>NCP(네이버 클라우드) — 공식 요금 계산기가 쓰는 요금 API (원화, 리전별)</li>
        <li className={LI}>삼성 SCP — 공식 요금 페이지가 쓰는 요금 데이터 파일 (원화)</li>
        <li className={LI}>NHN Cloud — 공식 요금 페이지가 서비스별로 불러오는 요금표 (원화, 리전별)</li>
        <li className={LI}>KT Cloud — 공식 상품 페이지가 불러오는 상품별 요금 문서 (원화)</li>
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
          지역(서울이면 한국, 도쿄면 일본, 싱가포르면 아시아태평양, 미국 리전이면 북미, 유럽 리전이면 유럽)에 있다고 가정합니다. 전송 GB·요청 수 구간 요금에 Front Door 기본료(월 $35)를
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

      <h2 className={H2}>OCI 비교 기준</h2>
      <p className={P}>
        OCI는 대표 3사 아래에 따로 보여줍니다. OCI가 제공하지 않는 구성 요소는 견적 줄에 <b>미제공</b>으로 표시하고 총액은 나머지 항목의
        합계로 보여주며, 이 경우 <b>최저가 비교에서 제외</b>합니다 — 빠진 항목 때문에 싸 보이는 것을 막기 위해서입니다.
      </p>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          VM은 크기를 자유롭게 고르는 <b>Flex 셰이프</b>(E4·E5·Standard3, ARM은 A1)를 대표 사이즈(vCPU × vCPU당 메모리 1·2·4·8·16GB)로
          펼쳐 비교합니다. OCI 단위인 OCPU는 x86에서 vCPU 2개, A1에서 vCPU 1개로 환산합니다. 신형 E6·A2·A4는 리전별 제공 여부를 공개
          자료로 확인할 수 없어 뺐습니다. OCI 요금은 리전과 무관하게 같고, 리전별 차이는 트래픽 요금뿐입니다.
        </li>
        <li className={LI}>
          <b>버스트 셰이프 미수록</b>: OCI에도 기준 사용률(12.5%·50%)을 정해 그만큼 싸게 쓰는 버스트 옵션이 있지만, AWS·Azure·GCP의 CPU
          크레딧 방식과 구조가 달라 지금 비교 방식에 넣지 않았습니다. &ldquo;버스트 인스턴스 포함&rdquo; 옵션은 OCI 결과에 영향이 없고, CPU를
          가끔만 쓰는 서버라면 OCI에서 실제로는 더 싸게 쓸 수 있습니다.
        </li>
        <li className={LI}>
          <b>약정 없음</b>: OCI는 리소스별 약정 상품이 없어(계정 단위 연간 크레딧만 있음) 1·3년 약정 기준에서도 정가로 계산하고
          &ldquo;약정가 없음&rdquo;으로 표시합니다.
        </li>
        <li className={LI}>블록 스토리지는 Balanced 성능(GB당 10 VPU), 오브젝트는 Standard. 트래픽은 월 10TB까지 무료이고 이후 아시아 $0.025·북미/유럽 $0.0085/GB입니다.</li>
        <li className={LI}>Kubernetes는 SLA가 있는 OKE Enhanced 클러스터(시간당 $0.10). 무료인 Basic 클러스터는 SLA가 없어 쓰지 않습니다.</li>
        <li className={LI}>
          로드밸런서는 Flexible Load Balancer(시간당 기본료 + 대역폭 Mbps당). 최소 대역폭 10Mbps를 시간당에 넣고, 처리 GB를 한 달 평균
          대역폭으로 환산합니다. 실제로는 설정한 최대 대역폭으로 과금되므로 트래픽이 몰리는 시간이 있으면 실제보다 낮게 나옵니다.
        </li>
        <li className={LI}>
          NAT 게이트웨이는 <b>0원</b>으로 계산합니다. 근거는 과금 품목 전체가 담긴 공식 가격 목록에 NAT 품목이 없다는 것입니다(공식 문서에
          요금 언급 없음).
        </li>
        <li className={LI}>
          관리형 DB: MySQL은 MySQL HeatWave의 ECPU 셰이프(ECPU를 vCPU로 간주, ECPU당 메모리 8GB), 이중화는 인스턴스 3개 구성이라
          컴퓨트·스토리지 3배입니다. PostgreSQL은 E5 Flex 컴퓨트 요금에 OCPU당 PostgreSQL 요금을 더한 값이고, 스토리지는 Optimized Storage
          요금에 가장 낮은 성능 등급(75,000 IOPS = 블록 성능 단위 30 VPU)의 성능 요금을 더한 값입니다(공식 비용 계산기와 같은 방식).
          이중화는 노드 2개라 컴퓨트 2배·스토리지는 노드 공유라 그대로입니다.
        </li>
        <li className={LI}>캐시는 OCI Cache(Valkey·Redis 호환) 노드 메모리 GB당 요금이며, 노드가 10GB를 넘으면 더 낮은 단가가 노드 전체에 적용됩니다. 이중화는 복제 노드 1개(2배).</li>
        <li className={LI}>
          서버리스 컨테이너는 Container Instances(같은 셰이프의 Compute 요금 그대로, OCPU 단위로 올림)입니다. 오토스케일·HTTPS 인그레스가
          없어 다른 3사 상품보다 기능이 적지만 OCI의 유일한 서버리스 컨테이너라 비교 대상으로 씁니다.
        </li>
        <li className={LI}>CDN은 OCI 자체 상품이 없어 미제공입니다. 로그는 OCI Logging(수집 무료, 저장 GB·월)이며 보관은 최대 180일이라 365·730일은 미제공입니다.</li>
      </ul>

      <h2 className={H2}>NCP(네이버 클라우드) 비교 기준</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          가격은 NCP 공식 요금 계산기가 쓰는 요금 API에서 받습니다(문서화되지 않은 경로라 막히면 공식 List Price API로 옮길 예정). 원화
          요금을 수집 시점 환율로 달러로 바꿔 저장하고, 원화로 볼 때는 같은 환율로 되돌리므로 NCP 원화 금액 그대로 표시됩니다.
        </li>
        <li className={LI}>제공 리전은 서울·도쿄·싱가포르입니다. 미국·유럽 리전은 VPC 서버 요금이 공개돼 있지 않아 &ldquo;이 리전 미제공&rdquo;으로 표시합니다.</li>
        <li className={LI}>
          VM은 3세대 일반 서버(Standard·High CPU·High Memory·CPU 타입, Intel·AMD)입니다. 한 달 내내 쓰는 기준이라, 시간 요금 × 730보다
          약 2% 싼 <b>월 요금</b>으로 계산합니다. 2세대는 기본 디스크 50GB가 서버 요금에 포함돼 있어, Micro는 계정당 1대라 뺐습니다. ARM·버스트
          서버는 없습니다.
        </li>
        <li className={LI}>블록 스토리지는 SSD(GB당 시간 0.16원), 오브젝트는 Object Storage(GB·월 28원, 서울 기준). 트래픽은 월 20GB 무료이고 이후 구간 요금입니다.</li>
        <li className={LI}>Kubernetes는 NKS 클러스터 요금(시간당 100원), 로드밸런서는 애플리케이션 로드밸런서 Small(시간당 26원 + 처리 GB당 9원, 규칙 5개까지 무료), NAT는 시간당 56원 + 처리 GB당 60원입니다.</li>
        <li className={LI}>
          관리형 DB는 Cloud DB for MySQL·PostgreSQL 서버 요금이고, 이중화는 2대 구성이라 2배입니다. 데이터 스토리지는 Block Storage SSD
          요금이며, 이중화 때는 서버마다 저장한다고 보고 2배로 <b>추정</b>했습니다. 도쿄·싱가포르는 DB·캐시가 2세대만 있어 2세대 요금입니다.
        </li>
        <li className={LI}>캐시는 Cloud DB for Redis 노드(1.5~204.8GB) 요금이고, 이중화는 복제 노드 1대를 더해 2배입니다.</li>
        <li className={LI}>CDN은 Global CDN(전송 GB 구간 + 요청 1만 건당 10원)입니다. 기존 CDN+는 NCP가 Deprecated로 표시해 쓰지 않습니다.</li>
        <li className={LI}>
          로그는 Cloud Log Analytics의 Standard(수집 무료, 보관 GB·월 800원)와 Premium(수집 GB당 500원, 보관 무료) 중 싼 쪽입니다. 요금제마다
          하루 수집량(20GB/100GB)과 보관량(100GB/1TB) 한도가 있어, 둘 다 넘으면 미제공으로 표시합니다.
        </li>
        <li className={LI}>서버리스 컨테이너는 NCP에 해당 상품이 없어 미제공입니다(Cloud Functions는 함수형이라 다른 종류). 약정 상품도 공개돼 있지 않아 1·3년 기준에서도 정가입니다.</li>
      </ul>

      <h2 className={H2}>삼성 SCP(Samsung Cloud Platform) 비교 기준</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          가격은 공식 요금 페이지가 쓰는 요금 데이터 파일에서 받습니다. 원화 요금을 수집 시점 환율로 달러로 바꿔 저장합니다 — SCP가 함께
          공개하는 달러 요금은 고정 환율(약 1,150원)로 계산돼 있어, 그대로 쓰면 원화로 볼 때 실제보다 비싸게 나오기 때문입니다.
        </li>
        <li className={LI}>제공 리전은 서울(KR-WEST)입니다. 요금 데이터가 한국 리전만 있어 다른 리전은 &ldquo;이 리전 미제공&rdquo;으로 표시합니다.</li>
        <li className={LI}>VM은 3세대 일반·대용량 Virtual Server(Intel Granite Rapids), 오픈소스 OS 요금입니다. ARM·버스트 서버는 없습니다.</li>
        <li className={LI}>
          <b>약정</b>은 Planned Compute(인스턴스 타입을 1·3년 약정, 월 요금)를 씁니다 — 3사 고정형 예약과 같은 성격입니다. 시간당 금액을
          약정하는 Cost Savings는 유연형이라 쓰지 않습니다. VM·DB·캐시에 적용됩니다.
        </li>
        <li className={LI}>블록 스토리지는 SSD(GB·월 120원), 오브젝트는 Object Storage(GB·월 28원). 트래픽은 월 20GB 무료이고 이후 구간 요금입니다. 대용량(5만GB 초과) 스토리지 할인은 반영하지 않습니다.</li>
        <li className={LI}>Kubernetes Engine은 클러스터당 시간 요금, 로드밸런서는 LB당 시간 요금 + 인입 트래픽 GB당, NAT Gateway는 시간 요금만 있습니다(처리 GB 요금 없음).</li>
        <li className={LI}>
          관리형 DB는 MySQL·PostgreSQL(DBaaS) 3세대 서버 요금입니다. 이중화는 Active-Standby 2대가 각자 스토리지를 갖는 구조라 컴퓨트·스토리지
          2배입니다. DB 데이터 스토리지 요금은 DB 요금표에 없어 Block Storage SSD 요금으로 <b>추정</b>했습니다.
        </li>
        <li className={LI}>캐시는 CacheStore(Redis 호환) 서버 요금이고, 서버 메모리를 캐시 메모리로 봅니다(실제로 쓸 수 있는 양은 조금 작음). 이중화는 복제 노드 1대(2배).</li>
        <li className={LI}>CDN은 Global CDN 전송 구간 요금입니다(요청 요금 없음).</li>
        <li className={LI}>로그는 ServiceWatch 로그(GB당 요금)입니다. 보관 요금은 공개된 요금표에 없어 수집 요금만 계산합니다.</li>
        <li className={LI}>서버리스 컨테이너는 해당 상품이 없어 미제공입니다(Cloud Functions는 함수형).</li>
      </ul>

      <h2 className={H2}>NHN Cloud 비교 기준</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>가격은 공식 요금 페이지가 서비스별로 불러오는 요금표에서 받고, 원화를 수집 시점 환율로 달러로 바꿔 저장합니다(원화 표시는 NHN 금액 그대로).</li>
        <li className={LI}>
          제공 리전은 서울(판교 KR1)·도쿄(JP1)입니다. 도쿄는 NKS·NAT Gateway·EasyCache·NCS·RDS for PostgreSQL 요금표가 비어 있어 해당
          구성 요소를 &ldquo;미제공&rdquo;으로 표시합니다.
        </li>
        <li className={LI}>
          VM은 Instance 일반 타입(t2·m2·c2·r2·x1, Linux)입니다. 도쿄의 u2(Basic)는 전용 로컬 스토리지가 서버 요금에 묶여 있어 뺐습니다. ARM은
          없고, t2가 버스트형이라는 공개 자료가 없어 버스트로 구분하지 않습니다.
        </li>
        <li className={LI}>블록 스토리지는 SSD(10GB당 시간 1.6원, 서울), 오브젝트는 Standard(10GB당 시간 0.4원). 트래픽은 월 1GB 무료이고 이후 GB당 100원입니다.</li>
        <li className={LI}>Kubernetes는 NKS 클러스터 요금(시간당 100원), 로드밸런서는 일반 Load Balancer(시간당 20원, 처리 요금 없음), NAT Gateway는 시간당 50원(처리 요금 없음)입니다.</li>
        <li className={LI}>
          관리형 DB는 RDS for MySQL·PostgreSQL 인스턴스 요금이고, 이중화는 같은 인스턴스를 하나 더 쓰는 구조라 2배입니다. 데이터 스토리지는 SSD
          요금, 이중화 때는 인스턴스마다 저장해 2배로 봤습니다. 루트·백업 볼륨은 포함하지 않습니다.
        </li>
        <li className={LI}>캐시는 EasyCache(Redis 호환) 인스턴스 요금이고, 이중화는 노드를 하나 더 둬 2배입니다. 메모리에 비례해 붙는 데이터 스토리지(HDD)는 비율이 공개돼 있지 않아 뺐습니다.</li>
        <li className={LI}>서버리스 컨테이너는 NCS(vCPU·메모리 초 단위 과금)이며, 허용 단위가 공개돼 있지 않아 요구 스펙 그대로 계산합니다(컨테이너당 최대 16 vCPU·225GB).</li>
        <li className={LI}>CDN은 국내외 구분 없는 전송 구간 요금(요청 요금 없음)입니다.</li>
        <li className={LI}>
          로그는 Log &amp; Crash Search의 Log Search입니다. 수집은 무료이고 보관 기간에 따라 요금제가 정해집니다(Basic 30일 GB·월 800원, Premium
          60~120일 1,600원). 180일 이상은 미제공입니다. API 호출 100만 건 초과 요금은 반영하지 않습니다.
        </li>
        <li className={LI}>공개된 약정 상품이 없어(고객센터 문의) 1·3년 기준에서도 정가입니다.</li>
      </ul>

      <h2 className={H2}>KT Cloud 비교 기준</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          가격은 공식 상품 페이지가 불러오는 상품별 요금 문서(표)에서 받고, 원화를 수집 시점 환율로 달러로 바꿔 저장합니다. 요금 문서는 사람이
          작성한 표라 형식이 바뀌면 수집이 멈추고 기존 데이터가 유지됩니다.
        </li>
        <li className={LI}>
          서울만 제공하며, Managed KS 워커 노드와 DBaaS가 D1 플랫폼(DX-M1 존) 기준이라 VM도 D1 요금으로 맞췄습니다. VM은 표준·High Memory
          서버이고, 한 달 내내 쓰는 기준이라 월 요금으로 계산합니다. ARM·버스트 서버는 없습니다.
        </li>
        <li className={LI}><b>약정</b>은 온라인 VM 약정 할인율(1년 15%·3년 25%)을 VM과 K8s 노드에 적용합니다. DB는 약정 대상이 아니라 정가입니다.</li>
        <li className={LI}>블록 스토리지는 서버용 SSD DISK(10GB당 월 1,400원), 오브젝트는 Standard(GB·월 30원)입니다.</li>
        <li className={LI}>
          트래픽은 <b>서버 1대마다 무료량</b>이 붙습니다(메모리 16GB 미만 512GB, 이상 1TB, 계정 합산). 시나리오의 VM 대수와 K8s 노드 수(요구 메모리
          기준)로 무료량을 합산하고, 넘는 양은 90·80·70원/GB 구간 요금입니다. 같은 페이지의 예시 문장은 무료량을 다르게 적고 있어 요금표 값을 따랐습니다.
        </li>
        <li className={LI}>Kubernetes는 Managed KS 클러스터(월 70,000원), 로드밸런서는 시간당 42원 + 처리 GB당 20원입니다.</li>
        <li className={LI}>
          관리형 DB는 DBaaS for MySQL·PostgreSQL(D 플랫폼) 요금입니다. 데이터 볼륨(SSD)마다 2배 크기의 백업용 볼륨이 함께 과금돼 스토리지는 데이터의
          3배입니다. 이중화는 PostgreSQL이 DB 2대 + Monitor 1대(문서 명시), MySQL이 Cluster로 DB 3대 + Router 2대입니다 — MySQL Cluster의 최소
          노드 수는 공개돼 있지 않아 3대로 <b>추정</b>했습니다.
        </li>
        <li className={LI}>CDN은 CDN Standard(전송 구간 + 요청 1만 건당 10원)입니다.</li>
        <li className={LI}>NAT·로그 수집은 공개 요금이 없고, 캐시(DBaaS for Cache)는 오픈 베타 무료 기간이라 정식 요금이 없으며, 서버리스 컨테이너는 상품이 없어 모두 미제공으로 표시합니다.</li>
      </ul>

      <h2 className={H2}>한계 — 이 견적이 말해주지 않는 것</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          기본 견적은 정가입니다. 약정은 &ldquo;요금 기준&rdquo;에서 1·3년 약정(위 기준)만 고를 수 있고, 여러 약정의 조합, Spot·선점형
          인스턴스, 기업 협상 할인(EDP 등)·크레딧, 계정당 무료 사용량은 반영하지 않습니다 — 실제 청구액은 더 낮을 수 있습니다.
        </li>
        <li className={LI}>
          스토리지 IOPS·처리량 추가분, 오브젝트 스토리지 API 요청, 스냅샷·백업, 가용 영역·리전 간 데이터 전송, 모니터링 지표·쿼리,
          기술 지원 플랜 요금은 포함하지 않습니다.
        </li>
        <li className={LI}>
          모든 리소스는 한 달 내내(730시간) 켜져 있다고 보고 계산합니다. 오토스케일·야간 중지처럼 사용량이 변하는 구성은 실제보다 높게
          나옵니다.
        </li>
        <li className={LI}>부가세 등 세금은 포함하지 않습니다 (국가에 따라 붙으며, 한국은 10%).</li>
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
      <p className={P}>
        Prices are collected automatically from each cloud&rsquo;s official pricing API. A few values the APIs don&rsquo;t provide
        (Azure and GCP instance specs, CloudFront flat-rate plans, Cloud SQL / Memorystore / Cloud Run commitment discount rates, Cloud
        CDN cache fill rates, etc.) come from the official docs and are recorded in code with the date they were checked.
      </p>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>AWS — Price List Bulk API (per-region offer files)</li>
        <li className={LI}>Azure — Retail Prices API</li>
        <li className={LI}>GCP — Cloud Billing Catalog API</li>
        <li className={LI}>OCI — price list API (every product; one price for all regions)</li>
        <li className={LI}>NCP (NAVER Cloud) — the pricing API behind the official cost calculator (KRW, per region)</li>
        <li className={LI}>Samsung SCP — the price data files behind the official pricing page (KRW)</li>
        <li className={LI}>NHN Cloud — the per-service price tables loaded by the official pricing page (KRW, per region)</li>
        <li className={LI}>KT Cloud — the per-product price documents loaded by the official product pages (KRW)</li>
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
          same area as the region (Seoul → Korea, Tokyo → Japan, Singapore → Asia Pacific, US regions → North America, European regions → Europe). We add tiered per-GB and per-request rates,
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

      <h2 className={H2}>OCI comparison basis</h2>
      <p className={P}>
        OCI is shown separately below the three main clouds. Components OCI doesn&rsquo;t offer are marked <b>not offered</b> on their
        line, the total sums the remaining items, and the platform is then <b>left out of the cheapest comparison</b> — so missing items
        can&rsquo;t make it look cheaper.
      </p>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          VMs use OCI&rsquo;s <b>Flex shapes</b> (E4, E5, Standard3, and A1 for Arm), whose size you choose freely, expanded into
          representative sizes (vCPU × 1/2/4/8/16 GB per vCPU). OCI bills in OCPUs: 1 OCPU = 2 vCPUs on x86 and 1 vCPU on A1. The newer E6,
          A2 and A4 are left out because their regional availability can&rsquo;t be confirmed from public sources. OCI prices are the same
          in every region; only traffic rates differ.
        </li>
        <li className={LI}>
          <b>Burstable shapes are not included</b>: OCI offers a burstable option priced by a baseline utilization (12.5% or 50%), but it
          works differently from the CPU-credit model of AWS, Azure and GCP, so it doesn&rsquo;t fit the current comparison. The
          &ldquo;include burstable&rdquo; option has no effect on OCI, and a server that only uses CPU occasionally may cost less on OCI
          than shown.
        </li>
        <li className={LI}>
          <b>No commitments</b>: OCI has no per-resource commitment products (only account-level annual credits), so it stays at on-demand
          prices under 1- and 3-year terms and is marked &ldquo;no commitment price&rdquo;.
        </li>
        <li className={LI}>Block storage uses Balanced performance (10 VPUs per GB); object storage uses Standard. The first 10 TB of internet traffic per month is free, then $0.025/GB in Asia and $0.0085/GB in North America/Europe.</li>
        <li className={LI}>Kubernetes uses OKE Enhanced clusters ($0.10/hour), which carry an SLA. Free Basic clusters have no SLA and are not used.</li>
        <li className={LI}>
          Load balancers use the Flexible Load Balancer (hourly base + bandwidth per Mbps). The minimum 10 Mbps is included in the hourly
          price, and processed GB are converted to an average monthly bandwidth. OCI actually bills the maximum bandwidth you configure, so
          spiky traffic will cost more than shown.
        </li>
        <li className={LI}>
          NAT gateways are counted as <b>$0</b>. The basis: OCI&rsquo;s official price list, which contains every billable product, has
          no NAT item (the docs don&rsquo;t mention a price).
        </li>
        <li className={LI}>
          Managed databases: MySQL uses MySQL HeatWave ECPU shapes (an ECPU is treated as a vCPU, 8 GB per ECPU); high availability runs
          three instances, tripling compute and storage. PostgreSQL is E5 Flex compute plus a per-OCPU PostgreSQL fee, and storage is
          Optimized Storage plus the performance charge of the lowest tier (75,000 IOPS = 30 block volume performance units), the same
          way OCI&rsquo;s official cost estimator calculates it; high availability uses two nodes, doubling compute, while storage is
          shared and stays the same.
        </li>
        <li className={LI}>Caches use OCI Cache (Valkey/Redis-compatible), priced per GB of node memory; nodes over 10 GB get a lower rate for the whole node. High availability adds one replica (2×).</li>
        <li className={LI}>
          Serverless containers use Container Instances (the same price as the matching Compute shape, rounded up to whole OCPUs). They
          lack autoscaling and HTTPS ingress, so they do less than the other three products, but they are OCI&rsquo;s only serverless
          container service.
        </li>
        <li className={LI}>OCI has no CDN of its own, so CDN is not offered. Logs use OCI Logging (ingestion free, storage per GB-month); retention tops out at 180 days, so 365 and 730 days are not offered.</li>
      </ul>

      <h2 className={H2}>NCP (NAVER Cloud) comparison basis</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          Prices come from the pricing API behind NCP&rsquo;s official cost calculator (an undocumented path; if it stops working we will
          move to the official List Price API). KRW prices are converted to USD at the exchange rate of the collection day, and the same
          rate converts them back, so KRW figures match NCP&rsquo;s own prices.
        </li>
        <li className={LI}>NCP is offered in Seoul, Tokyo and Singapore. The US and Europe regions have no published VPC server prices, so they show &ldquo;not offered in this region&rdquo;.</li>
        <li className={LI}>
          VMs are 3rd-generation general servers (Standard, High CPU, High Memory, CPU types; Intel and AMD). Because we assume a full
          month, we use the <b>monthly rate</b>, about 2% cheaper than the hourly rate × 730. 2nd-generation servers (which bundle a 50 GB
          disk) and Micro servers (one per account) are left out. NCP has no Arm or burstable servers.
        </li>
        <li className={LI}>Block storage is SSD (KRW 0.16 per GB-hour); object storage is Object Storage (KRW 28 per GB-month in Seoul). The first 20 GB of internet traffic per month is free, then tiered rates apply.</li>
        <li className={LI}>Kubernetes uses the NKS cluster fee (KRW 100/hour); load balancers use the Application Load Balancer Small (KRW 26/hour + KRW 9 per GB processed, first 5 rules free); NAT is KRW 56/hour + KRW 60 per GB processed.</li>
        <li className={LI}>
          Managed databases use Cloud DB for MySQL / PostgreSQL server prices; high availability runs two servers (2×). Data storage is
          billed at the Block Storage SSD rate, and for high availability we <b>assume</b> each server stores its own copy (2×). Tokyo and
          Singapore only have 2nd-generation DB and cache servers, so those prices are used there.
        </li>
        <li className={LI}>Caches use Cloud DB for Redis nodes (1.5–204.8 GB); high availability adds one replica (2×).</li>
        <li className={LI}>CDN uses Global CDN (tiered per-GB rates + KRW 10 per 10,000 requests). The older CDN+ is marked deprecated by NCP and is not used.</li>
        <li className={LI}>
          Logs use the cheaper of Cloud Log Analytics Standard (free ingestion, KRW 800 per GB-month stored) and Premium (KRW 500 per GB
          ingested, free storage). Each plan caps daily ingestion (20 GB / 100 GB) and stored volume (100 GB / 1 TB); if both are exceeded,
          logs are marked not offered.
        </li>
        <li className={LI}>NCP has no serverless container service (Cloud Functions is functions-as-a-service), so containers are not offered. No commitment products are published, so 1- and 3-year terms stay at on-demand prices.</li>
      </ul>

      <h2 className={H2}>Samsung SCP (Samsung Cloud Platform) comparison basis</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          Prices come from the price data files behind the official pricing page. KRW prices are converted to USD at the collection-day
          exchange rate — SCP also publishes USD prices, but they use a fixed rate (about KRW 1,150), which would overstate costs when
          viewed in KRW.
        </li>
        <li className={LI}>SCP is offered in Seoul (KR-WEST). The price data only covers Korean regions, so other regions show &ldquo;not offered in this region&rdquo;.</li>
        <li className={LI}>VMs are 3rd-generation general and large Virtual Servers (Intel Granite Rapids) with open-source OS pricing. SCP has no Arm or burstable servers.</li>
        <li className={LI}>
          <b>Commitments</b> use Planned Compute (1- or 3-year instance-type commitments, monthly price) — the same kind as the big three&rsquo;s
          reserved instances. Cost Savings (an hourly spend commitment) is the flexible kind and is not used. They apply to VMs, databases and
          caches.
        </li>
        <li className={LI}>Block storage is SSD (KRW 120 per GB-month); object storage is Object Storage (KRW 28 per GB-month). The first 20 GB of internet traffic per month is free, then tiered rates apply. Volume discounts above 50,000 GB are not included.</li>
        <li className={LI}>Kubernetes Engine is billed per cluster-hour, load balancers per LB-hour plus inbound GB, and the NAT Gateway per hour only (no per-GB charge).</li>
        <li className={LI}>
          Managed databases use 3rd-generation MySQL / PostgreSQL (DBaaS) server prices. High availability is Active-Standby with two servers,
          each with its own storage, so compute and storage double. The DB data storage price is not in the DB price table, so we{' '}
          <b>assume</b> the Block Storage SSD rate.
        </li>
        <li className={LI}>Caches use CacheStore (Redis-compatible) server prices, treating server memory as cache memory (usable memory is a little lower). High availability adds one replica (2×).</li>
        <li className={LI}>CDN uses Global CDN tiered transfer rates (no request fee).</li>
        <li className={LI}>Logs use ServiceWatch logs (per GB). No storage price is published, so only the ingestion fee is counted.</li>
        <li className={LI}>SCP has no serverless container service (Cloud Functions is functions-as-a-service), so containers are not offered.</li>
      </ul>

      <h2 className={H2}>NHN Cloud comparison basis</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>Prices come from the per-service price tables loaded by the official pricing page; KRW is converted to USD at the collection-day rate (KRW figures match NHN&rsquo;s own).</li>
        <li className={LI}>
          NHN Cloud is offered in Seoul (Pangyo, KR1) and Tokyo (JP1). Tokyo has empty price tables for NKS, NAT Gateway, EasyCache, NCS and
          RDS for PostgreSQL, so those components are shown as &ldquo;not offered&rdquo; there.
        </li>
        <li className={LI}>
          VMs are general Instance types (t2, m2, c2, r2, x1; Linux). Tokyo&rsquo;s u2 (Basic) bundles dedicated local storage into the server
          price, so it is left out. There is no Arm, and no public source says t2 is burstable, so it is not treated as burstable.
        </li>
        <li className={LI}>Block storage is SSD (KRW 1.6 per 10 GB-hour in Seoul); object storage is Standard (KRW 0.4 per 10 GB-hour). The first 1 GB of internet traffic per month is free, then KRW 100 per GB.</li>
        <li className={LI}>Kubernetes uses the NKS cluster fee (KRW 100/hour); load balancers use the general Load Balancer (KRW 20/hour, no processing fee); the NAT Gateway is KRW 50/hour (no processing fee).</li>
        <li className={LI}>
          Managed databases use RDS for MySQL / PostgreSQL instance prices; high availability adds an identical instance (2×). Data storage uses
          the SSD rate, doubled for high availability since each instance stores its own copy. Root and backup volumes are not included.
        </li>
        <li className={LI}>Caches use EasyCache (Redis-compatible) instance prices; high availability adds a node (2×). The HDD data storage that scales with memory is left out because the ratio isn&rsquo;t published.</li>
        <li className={LI}>Serverless containers use NCS (vCPU and memory billed per second); allowed increments aren&rsquo;t published, so the requested spec is used as-is (up to 16 vCPU and 225 GB per container).</li>
        <li className={LI}>CDN uses one tiered transfer price for all viewers (no request fee).</li>
        <li className={LI}>
          Logs use Log Search from Log &amp; Crash Search: ingestion is free and the plan follows retention (Basic 30 days at KRW 800 per
          GB-month, Premium 60–120 days at KRW 1,600). 180 days or more is not offered. API calls above 1 million are not included.
        </li>
        <li className={LI}>No commitment products are published (contact sales only), so 1- and 3-year terms stay at on-demand prices.</li>
      </ul>

      <h2 className={H2}>KT Cloud comparison basis</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          Prices come from the per-product price documents (tables) loaded by the official product pages; KRW is converted to USD at the
          collection-day rate. The documents are hand-written tables, so a format change stops collection and keeps the previous data.
        </li>
        <li className={LI}>
          KT Cloud is offered in Seoul only. Managed KS worker nodes and DBaaS run on the D1 platform (DX-M1 zone), so VMs use D1 prices too.
          VMs are standard and High Memory servers, priced at the monthly rate because we assume a full month. There are no Arm or burstable
          servers.
        </li>
        <li className={LI}><b>Commitments</b> apply the online VM commitment discount (15% for 1 year, 25% for 3 years) to VMs and K8s nodes. Databases are not eligible and stay at on-demand prices.</li>
        <li className={LI}>Block storage is the server SSD DISK (KRW 1,400 per 10 GB-month); object storage is Standard (KRW 30 per GB-month).</li>
        <li className={LI}>
          Internet traffic comes with a <b>free allowance per server</b> (512 GB under 16 GB of memory, 1 TB at 16 GB or more, pooled per account).
          We add up the allowance for the scenario&rsquo;s VMs and K8s nodes (by requested memory) and bill the rest at KRW 90/80/70 per GB tiers.
          An example on the same page states a different allowance; we follow the price table.
        </li>
        <li className={LI}>Kubernetes uses the Managed KS cluster fee (KRW 70,000/month); load balancers are KRW 42/hour + KRW 20 per GB processed.</li>
        <li className={LI}>
          Managed databases use DBaaS for MySQL / PostgreSQL (D platform). Each data volume (SSD) comes with a billed backup volume twice its size,
          so storage is three times the data size. High availability is two DB VMs + one monitor VM for PostgreSQL (documented) and a cluster of
          three DB VMs + two router VMs for MySQL — the minimum MySQL cluster size isn&rsquo;t published, so three is an <b>assumption</b>.
        </li>
        <li className={LI}>CDN uses CDN Standard (tiered transfer + KRW 10 per 10,000 requests).</li>
        <li className={LI}>NAT and log ingestion have no published prices, the cache (DBaaS for Cache) is in a free open beta without regular pricing, and there is no serverless container service — all are shown as not offered.</li>
      </ul>

      <h2 className={H2}>Limitations — what this estimate does not tell you</h2>
      <ul className="mt-2 list-disc pl-5">
        <li className={LI}>
          Estimates default to list prices. Under &ldquo;Pricing&rdquo; you can pick 1- or 3-year commitments (as described above);
          combinations of commitments, Spot/preemptible instances, negotiated discounts (EDP, etc.), credits and per-account free
          allowances are not reflected — your actual bill may be lower.
        </li>
        <li className={LI}>
          Extra storage IOPS/throughput, object storage API requests, snapshots and backups, cross-AZ and cross-region data transfer,
          monitoring metrics and queries, and support plan fees are not included.
        </li>
        <li className={LI}>
          Every resource is assumed to run all month (730 hours). Setups whose usage varies — autoscaling, shutting down at night —
          will come out higher than reality.
        </li>
        <li className={LI}>Taxes such as VAT are not included (they depend on your country — 10% in Korea).</li>
        <li className={LI}>Azure and GCP pricing APIs carry no specs, so only main series are cataloged (Azure: B·Bsv2/Dsv5·Dsv6/Esv5·Esv6/Fsv2/Dpsv6·Epsv6; GCP: E2/N1/N2/N2D/N4/N4D/C2/C2D/C3/C3D/C4/C4D/T2D/T2A/C4A). Some series such as Azure AMD variants (Dasv6, etc.) are not included, so the true cheapest option may differ.</li>
        <li className={LI}>These estimates are meant for <b>structural comparison and ballparking</b>, not as a basis for contracts or billing.</li>
      </ul>
    </>
  );
}
