# 설계 문서

> 기획: [PLANNING.md](./PLANNING.md) · 스택: Next.js 풀스택 + JSON 스냅샷(DB 없음) + GitHub Actions cron + Vercel

## 1. 시스템 전체 구성

```mermaid
flowchart LR
    subgraph CLOUD["클라우드 공식 가격 API"]
        AWS["AWS Price List"]
        AZ["Azure Retail Prices"]
        GCP["GCP Billing Catalog"]
    end

    subgraph GH["GitHub 레포 (이 레포 하나)"]
        CRON["Actions cron<br/>(일 1회)"] --> COL["collector/<br/>수집·정규화·검증"]
        COL -->|커밋| DATA["data/*.json<br/>정규화 요금 스냅샷"]
        SRC["src/<br/>Next.js 앱"]
    end

    subgraph VC["Vercel"]
        BUILD["next build"]
        CDN["CDN<br/>정적 페이지 + JSON"]
    end

    AWS --> COL
    AZ --> COL
    GCP --> COL
    DATA -->|push 트리거| BUILD
    SRC --> BUILD
    BUILD --> CDN
    CDN --> BR["브라우저<br/>견적 계산은 전부 클라이언트에서"]
```

핵심: **서버·DB 없음.** 데이터 갱신 = 봇 커밋 = 재배포. 가격 이력은 git 히스토리가 대신한다.

## 2. 데이터 갱신 흐름 (일 1회)

```mermaid
sequenceDiagram
    participant GA as GitHub Actions
    participant API as 3사 가격 API
    participant Repo as 레포 (data/)
    participant V as Vercel
    participant U as 브라우저

    GA->>API: 가격 조회 (3사 병렬)
    API-->>GA: 원본 SKU 데이터
    GA->>GA: 정규화 → 공통 스키마
    GA->>GA: 검증 (전일 대비 급변·건수 급감 감지)
    alt 검증 통과 & 변경 있음
        GA->>Repo: data/*.json 커밋 & push
        Repo->>V: push 웹훅
        V->>V: next build (JSON → 정적 페이지)
        V-->>U: CDN에서 최신 가격 서빙
    else 검증 실패
        GA->>GA: 커밋 중단 + 알림 (기존 데이터 유지)
    end
```

- 검증은 갱신 조건이 아니라 **안전장치**다. 가격 ±30% 급변, SKU 건수 급감은 실제 가격 변동이 아니라 수집기 버그(API 응답 형식 변경, 페이지네이션 누락 등)일 확률이 높으므로, 오염된 데이터가 배포되기 전에 차단하고 어제 데이터를 유지한다.
- 알림 = 검증 실패 시 Actions 잡을 실패 처리 → **GitHub 기본 실패 알림(이메일)**. 성공 시엔 알림 없음(알림 피로 방지) — 정상 동작은 봇 커밋 히스토리와 사이트의 수집 시각 배지로 확인.

## 3. 레포 구조

```
cloud-cost/
├── .github/workflows/
│   └── collect.yml          # cron 워크플로우 (일 1회 + 수동 실행)
├── collector/               # 수집기 — Next.js와 독립 실행 (npm run collect)
│   ├── providers/
│   │   ├── aws.ts           # 원본 API → 공통 스키마
│   │   ├── azure.ts
│   │   ├── azure-vm-sizes.ts    # Azure 스펙 카탈로그 (API에 vCPU·RAM 없음)
│   │   ├── gcp.ts           # ⚠ 난이도 최고 → 프로토타입 1순위
│   │   └── gcp-machine-types.ts # GCP 머신타입 카탈로그 (SKU는 코어·RAM 단가라 조합 필요)
│   ├── validate.ts          # 급변·누락 감지
│   └── main.ts
├── data/                    # 봇이 갱신하는 요금 스냅샷 (사람이 편집 금지)
│   ├── meta.json            # 수집 시각, USD/KRW 환율
│   └── {provider}/{region}/
│       ├── vm.json
│       ├── storage.json     # block-ssd + object-standard
│       └── egress.json
├── messages/                # UI 문구 (en.json / ko.json) — next-intl
├── src/
│   ├── app/                 # 라우트 (§6)
│   ├── components/
│   ├── i18n/                # 로케일 라우팅 설정
│   ├── proxy.ts             # next-intl 미들웨어 (로케일 감지·리다이렉트)
│   └── lib/
│       ├── schema.ts        # 공통 타입 — collector와 웹이 공유 (§4)
│       ├── pricing.ts       # data/ 로더
│       └── estimator/       # 견적 엔진 — 순수 함수, UI 무관 (§5)
└── docs/
```

- **collector 실행 구조**: 워크플로우는 `npm run collect`(= `collector/main.ts`) 하나만 실행. main.ts가 providers 3개를 병렬 호출 → validate → `data/` 기록. 커밋은 워크플로우의 다음 스텝. 로컬에서도 같은 명령으로 실행 가능(그냥 Node 스크립트).
- **모듈 관계**: `data/*.json` → `pricing.ts`(경로·타입을 아는 유일한 로더) → `estimator/`(순수 함수 계산) → `components/`(표시).

### Next 앱 내부 (src/)

```
src/
├── app/                          # 파일 기반 라우팅 (폴더 = URL)
│   ├── [locale]/                 # 로케일 세그먼트 — en은 프리픽스 없음, ko는 /ko
│   │   ├── layout.tsx            # 공통 셸 (헤더/푸터, 메타데이터, 언어 스위처, 피드백)
│   │   ├── page.tsx              # `/` 시나리오 빌더
│   │   ├── instances/page.tsx    # `/instances` 비교표
│   │   └── methodology/          # `/methodology` 데이터 안내 (content.tsx = 로케일별 본문 JSX)
│   └── api/feedback/route.ts     # POST — 피드백 → GitHub 이슈 생성
├── components/
│   ├── scenario/
│   │   ├── ScenarioBuilder.tsx   # 'use client' — 시나리오 상태 + URL 동기화
│   │   ├── ResourceCard.tsx      # VM 입력 카드
│   │   ├── StorageTrafficCard.tsx # 스토리지·트래픽 입력 카드
│   │   ├── NumberField.tsx
│   │   └── EstimateResult.tsx    # 3사 견적 카드 + 비용 분해 + 인스턴스 드롭다운
│   ├── instances/
│   │   └── InstanceTable.tsx     # 필터 가능한 단품 비교표
│   ├── DataFreshness.tsx         # 수집 시각 배지
│   ├── FeedbackWidget.tsx
│   └── LocaleSwitcher.tsx
└── lib/
    ├── schema.ts
    ├── pricing.ts
    ├── scenario-url.ts           # 시나리오·매칭 옵션·커스텀 선택 ↔ URL 코덱
    ├── display.ts                # 통화(USD/KRW)·기간(시간/일/주/월) 표시 변환
    ├── seo.ts                    # canonical·hreflang
    └── estimator/
        ├── index.ts              # estimate() 진입점 + VM 매칭·egress 구간 계산
        └── estimator.test.ts     # 견적 정확성 = 테스트로 보장
```

- 기본은 서버 컴포넌트(빌드 시 HTML로 구움) — `/instances`, `/methodology`는 순수 SSG로 SEO 대응.
- `ScenarioBuilder`만 `'use client'`: 요금표 JSON을 번들에 포함해 내려보내고(v1 규모 수백 KB), 입력 변경 시 브라우저에서 estimator 즉시 재실행 → 서버 왕복 없는 실시간 견적. 매일 재빌드되므로 번들 속 요금표도 항상 최신.

## 4. 데이터 스키마 (`src/lib/schema.ts`)

> **SKU**(Stock Keeping Unit): 과금되는 상품 단위 하나. "서울 리전의 t3.medium, Linux, 온디맨드"가 SKU 1개다. 3사 가격 API가 모두 쓰는 표준 용어.

```ts
type Provider = 'aws' | 'azure' | 'gcp';
type Region = 'seoul' | 'us-east';          // 정규화 리전 키 (아래 매핑표)
type Arch = 'x86' | 'arm';                  // arm = Graviton(AWS)·Ampere(Azure/GCP)

/** VM — 가격은 USD, Linux 온디맨드, 시간당 */
interface VmSku {
  provider: Provider;
  region: Region;
  sku: string;              // "t3.medium" | "e2-medium" | "Standard_B2s"
  vcpu: number;
  ramGb: number;
  burstable: boolean;       // 매칭 시 포함/제외 옵션
  arch: Arch;               // 매칭 필터 + 표시 배지 (arch 도입 전 스냅샷은 로더가 x86로 백필)
  generation: string;       // 패밀리 키 (t3·m5·dsv5·e2·n2 …)
  pricePerHour: number;
}

/** 스토리지 — GB·월 단가 */
interface StorageSku {
  provider: Provider;
  region: Region;
  kind: 'block-ssd'          // VM에 붙는 디스크 (EBS/Managed Disk/PD) — v1은 범용 SSD 고정
      | 'object-standard';   // S3류 오브젝트 스토리지 (S3/Blob/GCS) — v1은 표준 티어만
  pricePerGbMonth: number;
}

/** egress = 클라우드 밖(인터넷)으로 나가는 데이터 전송. 들어오는 건(ingress) 3사 모두 무료, 나가는 것만 GB당 과금 */
interface EgressTier {
  provider: Provider;
  region: Region;
  freeGb: number;           // 월 무료 구간
  tiers: { upToGb: number | null; pricePerGb: number }[];  // null = 무제한
}

/** data/meta.json */
interface Meta {
  collectedAt: string;      // ISO 8601
  usdKrw: { rate: number; at: string } | null;  // 환율 조회 실패 시 null
}
```

**리전 매핑표**

| 정규화 키 | AWS | Azure | GCP |
|---|---|---|---|
| `seoul` | ap-northeast-2 | koreacentral | asia-northeast3 |
| `us-east` | us-east-1 | eastus | us-east1 |

## 5. 견적 엔진 (`src/lib/estimator/`)

```mermaid
flowchart TD
    S["시나리오 (URL로 인코딩 → 공유 가능)<br/>VM 2vCPU/4GB ×2 · 블록 100GB<br/>오브젝트 500GB · egress 1TB"] --> E{"리소스 타입별 계산<br/>(×3사 각각)"}
    E -->|VM| F["후보 필터<br/>vCPU·RAM 최소 만족<br/>+ 버스트·아키텍처 옵션"] --> M["최저가 인스턴스 선택<br/>(사용자가 다른 후보로 변경 가능)<br/>선택 결과를 반드시 노출"]
    E -->|스토리지| G["용량 × GB·월 단가"]
    E -->|egress| T["무료 구간 차감 →<br/>구간별 누적 계산"]
    M --> SUM["월 총액 + 항목별 분해"]
    G --> SUM
    T --> SUM
    SUM --> OUT["AWS $x · Azure $y · GCP $z<br/>최저가 강조 + KRW 환산"]
```

- 순수 함수로 작성 (`estimate(scenario, priceData) → Estimate[]`) — 테스트가 곧 검증 수단
- 월 환산: 시간당 가격 × **730시간** 고정
- 매칭 옵션: 버스트 포함(기본 포함), 아키텍처 `both`(기본) / `x86` / `arm`. 현세대 한정은 수집 단계에서 걸러짐(엔진에 세대 필터 없음)
- 커스텀 선택: 드롭다운 후보 = 조건 충족 SKU 중 사이즈(vCPU·RAM)별 최저가 1개. 고른 SKU가 조건에서 벗어나면 최저가로 self-heal
- 매칭 실패 시 이유(`noMatch`)를 함께 반환: `arch`(버스트·아키텍처 조건에 맞는 SKU가 리전에 없음) / `size`(조건 내 최대 vCPU·RAM 안내) — "견적 불가"가 버그로 보이지 않게
- 시나리오 상태는 URL 쿼리에 인코딩 → 저장 기능 없이 공유 가능. 예: `/?r=seoul&vm=2c4g:2&blk=100&obj=500&eg=1024&arch=x86&burst=0&pick=aws:0:t3.large` — URL 자체가 시나리오 데이터라서 열면 같은 화면이 재구성됨 (`arch`·`burst`·`pick`은 기본값이면 생략)
- 통화·기간 전환은 엔진 밖 표시 계층(`display.ts`)에서 월 USD에 곱셈만 — 엔진 출력은 항상 월 USD

## 6. 라우트

| 경로 | 렌더링 | 내용 |
|---|---|---|
| `/` | SSG + 클라이언트 계산 | 시나리오 빌더 + 실시간 3사 견적 (핵심 화면) |
| `/instances` | SSG | 인스턴스 단품 비교표 — SEO 랜딩 |
| `/methodology` | SSG | 데이터 출처·수집 시각·계산 방식·한계 고지 |
| `/api/feedback` | 서버리스 함수 (POST) | 피드백 폼 → GitHub 이슈 생성 (허니팟 스팸 방어). Vercel env `FEEDBACK_GITHUB_TOKEN` 필요 |

- 페이지는 모두 영어가 기본(프리픽스 없음), 한국어는 `/ko` 프리픽스 (`/ko/instances` 등). hreflang·canonical은 `seo.ts`

## 7. 설계 결정 요약

| 결정 | 선택 | 이유 |
|---|---|---|
| 견적 계산 위치 | 클라이언트 | 요금표 몇 MB → 브라우저에서 즉시 재계산, 서버 불필요 |
| 데이터 저장 | git 커밋되는 JSON | DB 오버엔지니어링 회피 + 이력 공짜 |
| 갱신 전략 | 커밋 → 재빌드 (ISR 불사용) | 일 1회 갱신이면 충분, 파이프라인 단순 |
| 수집기 언어 | TypeScript (웹과 동일) | `schema.ts` 타입 공유로 수집↔웹 스키마 불일치 원천 차단 |
| 시나리오 공유 | URL 인코딩 | 계정/DB 없이 공유 가능, v3에서 단축 URL 추가 여지 |
| VM 범위 | x86 + ARM, 기본은 둘 다 통틀어 최저가 (2026-07-20, 이전 결정 "x86만" 대체) | ARM이 대개 더 싸서 빼면 실제 최저가를 놓침. 앱 호환성 문제는 아키텍처 토글(둘 다/x86/ARM) + ARM 배지·안내로 사용자에게 맡김 |
| 버스트 인스턴스 | 기본 포함, 체크박스로 제외 (끄면 URL에 `burst=0`) | 기획 §10-1 미결정 사항을 구현으로 확정 |
| 국제화 | 영어 기본(`/`) + 한국어(`/ko`), next-intl `as-needed` | 언어 스위처는 일반 `<a>` — `Link` 프리페치가 `/`→`/ko` 리다이렉트를 캐시해 전환이 깨지는 문제 회피 |
| 피드백 창구 | 폼 → `/api/feedback` → GitHub 이슈 | DB 없는 구조 유지 |
| 블록 스토리지 지표 | 범용 SSD: gp3 / Balanced PD / **Premium SSD v2** | Azure 관리 디스크는 고정 크기 과금이라 per-GB 모델과 불일치 → 유일한 per-GB 디스크인 SSD v2 사용 |
| egress 지표 | 3사 모두 **인터넷 라우팅** 기준 | GCP Premium 티어는 목적지별 SKU라 단일 가격이 없음 → GCP Standard 티어 / Azure Routing Preference: Internet / AWS 기본으로 통일 |
