# 플랫폼 추가 후보 조사 (2026-10-17)

AWS·Azure·GCP 외 플랫폼을 넣기 위한 조사 기록. 결정은 [ARCHITECTURE §7](ARCHITECTURE.md#7-설계-결정-요약)에 있다.

**순서(합의)**: OCI → NCP → (KT·NHN·삼성 SCP 등 다시 논의).

## 1. 가격 데이터 수집 방법

수집기는 GitHub Actions(미국 러너)에서 매일 돈다. 그래서 "해외 IP에서, 사람 손 없이" 받을 수 있는지가 기준이다.

| 후보 | 방법 | 인증 | 비고 |
|---|---|---|---|
| OCI | 공개 API `apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD` | 없음 | 668개 품목. **리전 무관 단일가**(트래픽만 지역별) |
| Akamai(Linode) | 공개 API `api.linode.com/v4/{linode,lke,databases,nodebalancers,volumes,object-storage,network-transfer}/types` | 없음 | 리전 예외가(`region_prices`)만 따로 |
| Vultr | `api.vultr.com/v2/plans`·`regions` 공개, DB·LB는 401 | 무료 계정 API 키 | |
| Hetzner | `api.hetzner.cloud/v1/pricing` | 토큰 | |
| DigitalOcean | `/v2/sizes` | 토큰 | Droplet 가격만 있음. LB·NAT·DB 가격은 API에 없음 |
| NCP | ① 공식: List Price API `billingapi.apigw.ntruss.com/billing/v1/product/getProductPriceList?regionCode=` ② **사용 중**: 요금 계산기 API `www.ncloud.com/api-usage/charge/price/{1 KR·7 SGN·8 JPN}` | ① Access/Secret 키 + HMAC 서명 ② 없음 | ②는 미문서화 내부 경로, 원화. 막히면 ①로 전환 |
| NHN Cloud | ① 공식: 프레임워크 API "종량제 서비스 가격 조회"(User Access Key) ② **사용 중**: 가격 페이지가 부르는 `www.nhncloud.com/xcms-api/v1/contents/{id}?languageCode=KO&countryCode=KR&templateContext={"isPricingPage":true,"tab":"pricing","pricingRegionCode":"KR1"}` | ② 없음 | ②는 서비스별 HTML 표 조각(예: m2.c2m4 93원/시간), 콘텐츠 ID는 `homepage/v2/content-maps`로 찾음. 리전 목록 API 기준 KR1·KR2·KR3·JP1(US1 없음). robots.txt 전체 허용 |
| 삼성 SCP | **사용 중**: 가격 페이지가 import하는 정적 JS `cloud.samsungsds.com/serviceportal/assets/js/data/price/{서비스}Price.js` | 없음 | `[리전][표][통화] = [[사이즈, vCPU, GB, 원/시간…]]` 배열 — 코드 실행 없이 배열 리터럴만 파싱. KRW·USD(USD는 고정 환율), 약정형(`*CostSavings`·`*PlannedCompute`) 별도 파일. 리전 데이터는 KR_WEST·KR_WEST_2·KR_SOUTH(US_WEST 데이터 없음) |
| KT Cloud | 공개 API 없음(요금 조회는 파트너 전용 Reseller API). 웹 상품 페이지(`cloud.kt.com/product/computing/server/`)에 요금표가 있다는 검색 결과는 있음 | — | **미확인**: 첫 요청 뒤 연결 차단(curl 타임아웃, WebFetch ECONNREFUSED). 해외·봇 차단이면 GitHub Actions 수집 불가 → 로컬 수집이나 수동 갱신 필요 |

크롤링 공통 위험: 사이트 개편 시 수집 깨짐(validate가 잡아야 함), 내부 경로라 예고 없이 바뀜. 하루 1회·수십 요청 수준으로 제한.

## 2. 리전 (지원 7개 기준)

| 후보 | 서울 | 도쿄 | 싱가포르 | 미국 동부 | 미국 서부 | 프랑크푸르트 | 런던 |
|---|---|---|---|---|---|---|---|
| OCI | ✓ | ✓ | ✓ | ✓ Ashburn | ✓ San Jose | ✓ | ✓ |
| Vultr | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Linode | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DigitalOcean | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| NCP | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| NHN | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 삼성 SCP | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| KT | ✓ | ? | ? | ? | ? | ? | ? |
| Hetzner | ✗ | ✗ | ✓ | ✓ | ✓ | △ 뉘른베르크 | ✗ |

NCP 미국 서부·독일·홍콩은 리전별 요금 페이지에 VPC 서버 요금표가 없어 미제공으로 봤다 (2026-10-17).

## 3. 구성 요소 커버리지 · 약정

| 후보 | 없는 구성 요소 | 약정 |
|---|---|---|
| OCI | CDN | 리소스별 약정 없음(계정 단위 크레딧뿐) |
| NCP | 서버리스 컨테이너 (Cloud Functions는 FaaS) | 공개 상품 없음 (요금 API의 약정 필드 비어 있음) |
| NHN | 서울은 없음. 도쿄는 NKS·NAT·EasyCache·NCS·PostgreSQL 요금표가 비어 있음 | 고객센터 문의(공개 약정 없음) |
| 삼성 SCP | 서버리스 컨테이너 (로그는 ServiceWatch, 보관 요금 미공개) | 있음 — Planned Compute(인스턴스 타입 고정)를 사용, Cost Savings(금액 약정)는 미사용 |
| DigitalOcean | 로그 | 없음 |
| Vultr | 로그, 서버리스 컨테이너 | 없음 |
| Linode | NAT, 캐시, CDN(셀프서브 없음), 로그, 컨테이너 | 없음 |
| Hetzner | K8s, DB, 캐시, NAT, CDN, 로그, 컨테이너 | 없음 |

Vultr·Linode·DO는 VM 요금에 트래픽 무료량이 들어 있고 계정 단위로 합산(pool)된다 → egress 계산 방식을 따로 정해야 한다.
