export type StageStatus = "normal" | "waiting" | "review" | "error";

export type FlowStage = {
  id: string; name: string; short: string; role: string; count: number; amount: number;
  status: StageStatus; detail: string; timestamp: string;
};
export type Hypothesis = {
  title: string; confidence: "높음" | "중간" | "낮음"; score: number; summary: string;
  evidence: string[]; counterEvidence: string[]; nextChecks: string[];
};
export type IncidentRow = {
  transactionId: string; store: string; cardCompany: string; amount: number;
  approvedAt: string; batchId: string; state: string;
};
export type Scenario = {
  id: string; label: string; eyebrow: string; description: string; tone: "blue" | "red" | "violet";
  classification: string; eventTitle: string; eventSummary: string; flow: FlowStage[];
  impactCount: number; impactAmount: number; divergence: string; commonTraits: string[];
  hypotheses: Hypothesis[]; recommendedOwner: string; recommendedTeam: string;
  requestMessage: string; incidents: IncidentRow[]; resolvedFlow: FlowStage[];
};

const HUNDRED_M = 100_000_000;
const NINETY_FIVE_M = 95_000_000;
const s = (id: string, name: string, short: string, role: string, count: number, amount: number, status: StageStatus, detail: string, timestamp: string): FlowStage =>
  ({ id, name, short, role, count, amount, status, detail, timestamp });

const healthyFlow = (): FlowStage[] => [
  s("pos", "POS 매출", "POS", "판매 기록", 100, HUNDRED_M, "normal", "전체 거래 정상 수집", "07-15 23:59"),
  s("van", "VAN 승인", "VAN", "승인 중계", 100, HUNDRED_M, "normal", "승인 응답 정상", "07-16 00:01"),
  s("card", "카드사 매입", "CARD", "매입 확정", 100, HUNDRED_M, "normal", "누락 거래 재반영", "07-16 10:18"),
  s("settlement", "정산 예정", "SET", "지급액 계산", 100, 98_300_000, "normal", "수수료 1,700,000원 반영", "07-16 10:20"),
  s("bank", "은행 입금", "BANK", "실입금 확인", 100, 98_300_000, "normal", "입금 예정액 일치", "07-17 09:12"),
  s("erp", "ERP 전표", "ERP", "회계 반영", 100, 98_300_000, "normal", "전표 생성 완료", "07-17 09:20"),
];

const lateRows: IncidentRow[] = [
  ["POS-0715-0096", 1_200_000, "23:55:12"], ["POS-0715-0097", 850_000, "23:56:08"],
  ["POS-0715-0098", 1_350_000, "23:57:31"], ["POS-0715-0099", 600_000, "23:58:45"],
  ["POS-0715-0100", 1_000_000, "23:59:03"],
].map(([transactionId, amount, approvedAt]) => ({ transactionId: String(transactionId), store: "강남점", cardCompany: "신한카드", amount: Number(amount), approvedAt: String(approvedAt), batchId: "SETTLE-0715-03", state: "매입 대기" }));

const failedRows = lateRows.map((row, index) => ({
  ...row, transactionId: `POS-0715-${String(41 + index).padStart(4, "0")}`, approvedAt: `22:${42 + index}:1${index}`, state: "전송 재시도",
}));

export const scenarios: Scenario[] = [
  {
    id: "normal-delay", label: "정상적인 매입 지연", eyebrow: "같은 불일치, 다른 판단",
    description: "카드사 마감 이후 승인된 5건이 다음 영업일 매입을 기다리는 정상 시차입니다.",
    tone: "blue", classification: "정상 지연",
    eventTitle: "승인 5건이 매입 단계에 아직 반영되지 않았습니다",
    eventSummary: "현재 숫자는 불일치하지만 시간·배치 조건상 즉시 장애 문의가 필요하지 않은 사례입니다.",
    flow: [
      s("pos", "POS 매출", "POS", "판매 기록", 100, HUNDRED_M, "normal", "전체 거래 정상 수집", "07-15 23:59"),
      s("van", "VAN 승인", "VAN", "승인 중계", 100, HUNDRED_M, "normal", "승인번호 100건 확인", "07-16 00:01"),
      s("card", "카드사 매입", "CARD", "매입 확정", 95, NINETY_FIVE_M, "waiting", "5건 다음 영업일 반영 예정", "07-16 09:00"),
      s("settlement", "정산 예정", "SET", "지급액 계산", 95, 93_385_000, "waiting", "매입 대기분 제외", "07-16 09:04"),
      s("bank", "은행 입금", "BANK", "실입금 확인", 95, 93_385_000, "waiting", "입금 예정일 미도래", "07-17 예정"),
      s("erp", "ERP 전표", "ERP", "회계 반영", 95, 93_385_000, "waiting", "다음 배치 반영 예정", "07-17 예정"),
    ],
    impactCount: 5, impactAmount: 5_000_000, divergence: "VAN 승인 → 카드사 매입",
    commonTraits: ["23:55 이후 승인", "신한카드", "강남점", "동일 정산 배치"],
    hypotheses: [
      { title: "카드사 매입 마감 이후 발생한 정상 지연", confidence: "높음", score: 92,
        summary: "현재는 오류 처리보다 다음 영업일 자동 반영 여부를 먼저 확인하는 것이 효율적입니다.",
        evidence: ["누락 5건이 모두 23:55 이후 승인", "해당 카드사 당일 매입 마감은 23:50", "과거 유사 사례 8건 중 6건이 다음 영업일 자동 해소", "배치 실패·경고 로그 없음"],
        counterEvidence: ["평균 반영 시각보다 현재 35분 지연"], nextChecks: ["다음 영업일 10시 매입 반영 여부", "카드사 정산 공지 및 휴일 캘린더"] },
      { title: "VAN 매입 전송의 일시적 지연", confidence: "중간", score: 48,
        summary: "네트워크 지연 가능성은 있으나 실패를 뒷받침하는 로그가 없습니다.", evidence: ["5건이 짧은 시간대에 집중"],
        counterEvidence: ["전송 재시도와 오류 로그 없음", "다른 점포의 동일 카드사는 정상"], nextChecks: ["VAN 미전송 큐 잔여 건수"] },
      { title: "가맹점·점포 코드 매핑 누락", confidence: "낮음", score: 18,
        summary: "최근 마스터 변경이 없어 우선 확인할 필요가 낮습니다.", evidence: ["동일 점포 거래에 집중"],
        counterEvidence: ["직전 거래까지 동일 코드로 정상 매입", "최근 30일 마스터 변경 없음"], nextChecks: ["카드사 가맹점 코드 활성 상태"] },
    ],
    recommendedOwner: "박정산", recommendedTeam: "정산 운영팀",
    requestMessage: "7월 15일 강남점 신한카드 승인 거래 5건이 매입 단계에 미반영 상태입니다. 모두 카드사 마감시간 이후 승인된 거래이며 실패 로그는 확인되지 않았습니다. 다음 영업일 10시까지 자동 반영 여부를 모니터링한 후 미반영 시 SETTLE-0715-03 배치 상태를 확인해 주세요.",
    incidents: lateRows, resolvedFlow: healthyFlow(),
  },
  {
    id: "batch-failure", label: "VAN·정산 배치 부분 실패", eyebrow: "실제 조사 필요",
    description: "마감 이전 거래가 동일 배치에서 일부 누락되고 재시도 경고가 남은 실제 오류입니다.",
    tone: "red", classification: "확인 필요",
    eventTitle: "승인 완료 거래 5건이 매입 전송에서 멈췄습니다",
    eventSummary: "표면적인 건수는 정상 지연 사례와 같지만 배치·시간 단서가 실제 인터페이스 오류를 가리킵니다.",
    flow: [
      s("pos", "POS 매출", "POS", "판매 기록", 100, HUNDRED_M, "normal", "전체 거래 정상 수집", "07-15 23:59"),
      s("van", "VAN 승인", "VAN", "승인 중계", 100, HUNDRED_M, "normal", "승인번호 100건 확인", "07-15 22:50"),
      s("card", "카드사 매입", "CARD", "매입 확정", 95, NINETY_FIVE_M, "error", "5건 전송 재시도 후 제외", "07-15 23:10"),
      s("settlement", "정산 예정", "SET", "지급액 계산", 95, 93_385_000, "review", "원천 대비 5건 부족", "07-16 02:00"),
      s("bank", "은행 입금", "BANK", "실입금 확인", 95, 93_385_000, "waiting", "부족액 반영 예정", "07-17 예정"),
      s("erp", "ERP 전표", "ERP", "회계 반영", 95, 93_385_000, "review", "95건만 전표 생성", "07-16 03:20"),
    ],
    impactCount: 5, impactAmount: 5_000_000, divergence: "VAN 승인 → 카드사 매입",
    commonTraits: ["마감 이전 승인", "강남점", "재시도 2회", "SETTLE-0715-03"],
    hypotheses: [
      { title: "VAN 매입 전송 배치의 부분 실패", confidence: "높음", score: 89,
        summary: "누락 거래 5건을 재전송하고 배치의 부분 성공 처리 조건을 확인해야 합니다.",
        evidence: ["모든 누락 거래가 마감 1시간 이전 승인", "동일 배치에서 WARN_RETRY 로그 2회 발생", "원천 100건·전송 완료 95건으로 건수 불일치", "다른 카드사와 점포는 정상"],
        counterEvidence: ["배치 최종 상태는 SUCCESS로 기록"], nextChecks: ["전송 큐의 실패 메시지 5건", "부분 성공 시 최종 상태 결정 로직", "재시도 후 제외 조건"] },
      { title: "정산 대상 조건의 점포 필터 오류", confidence: "중간", score: 57,
        summary: "강남점 거래에 집중돼 있어 대상 조건도 함께 확인할 가치가 있습니다.", evidence: ["누락 5건이 모두 강남점 거래", "배치 설정이 당일 오전 변경됨"],
        counterEvidence: ["같은 점포의 나머지 95건은 정상 처리"], nextChecks: ["금액·단말기 단위 제외 조건", "당일 배치 파라미터 변경 내역"] },
      { title: "정상적인 카드사 매입 지연", confidence: "낮음", score: 14,
        summary: "거래시간과 재시도 로그를 고려하면 정상 지연 가능성은 낮습니다.", evidence: ["카드사 응답 지연 공지가 있었음"],
        counterEvidence: ["마감 이전 거래", "동일 카드사의 다른 점포 거래는 정상 매입"], nextChecks: ["카드사 장애 공지의 영향 가맹점 범위"] },
    ],
    recommendedOwner: "이연동", recommendedTeam: "VAN·정산 인터페이스 운영팀",
    requestMessage: "7월 15일 강남점 카드 승인 거래 중 5건(총 5,000,000원)이 카드사 매입 단계부터 반영되지 않았습니다. POS와 VAN 승인까지는 정상이며 SETTLE-0715-03 배치에서 재시도 경고 2회가 확인됩니다. 실패 메시지 5건의 전송 상태, 부분 성공 처리 조건 및 재처리 가능 여부를 우선 확인해 주세요.",
    incidents: failedRows, resolvedFlow: healthyFlow(),
  },
  {
    id: "offsetting-errors", label: "누락·중복 상쇄", eyebrow: "합계는 정상, 구성은 오류",
    description: "100만 원 누락과 100만 원 중복이 동시에 발생해 전체 금액만 보면 정상으로 보입니다.",
    tone: "violet", classification: "거래 구성 오류",
    eventTitle: "총액은 일치하지만 ERP 거래 구성이 원천과 다릅니다",
    eventSummary: "합계 대사에서는 발견되지 않지만 고유 거래번호 비교에서 누락과 중복이 동시에 확인됐습니다.",
    flow: [
      s("pos", "POS 매출", "POS", "판매 기록", 100, HUNDRED_M, "normal", "거래번호 100개", "07-15 23:59"),
      s("van", "VAN 승인", "VAN", "승인 중계", 100, HUNDRED_M, "normal", "승인번호 100개", "07-16 00:01"),
      s("card", "카드사 매입", "CARD", "매입 확정", 100, HUNDRED_M, "normal", "원천 구성 일치", "07-16 01:20"),
      s("settlement", "정산 예정", "SET", "지급액 계산", 100, 98_300_000, "normal", "정산 대상 일치", "07-16 02:00"),
      s("bank", "은행 입금", "BANK", "실입금 확인", 100, 98_300_000, "normal", "총액 일치", "07-17 09:12"),
      s("erp", "ERP 전표", "ERP", "회계 반영", 100, 98_300_000, "error", "1건 누락·1건 중복", "07-17 09:20"),
    ],
    impactCount: 2, impactAmount: 2_000_000, divergence: "정산 → ERP 전표 구성",
    commonTraits: ["동일 재처리 배치", "원천번호 재사용", "총액 차이 0원", "ERP 단계에서만 발생"],
    hypotheses: [
      { title: "ERP 재처리 배치의 중복 방지 실패", confidence: "높음", score: 94,
        summary: "실패 거래 재처리 시 기존 성공 거래까지 다시 생성되고 원래 실패 건은 제외된 정황입니다.",
        evidence: ["중복 전표가 재처리 배치 시각에 생성", "두 전표가 동일 원천번호 참조", "누락 거래와 중복 거래 금액이 동일", "ERP 이전 단계의 거래 구성은 모두 일치"],
        counterEvidence: ["배치 로그에는 중복 경고가 없음"], nextChecks: ["ERP 전표 생성의 멱등성 키", "재처리 대상 선정 쿼리", "기존 전표 존재 여부 검사"] },
      { title: "수동 전표 입력 과정의 거래 선택 오류", confidence: "중간", score: 43,
        summary: "재처리 직전 수동 작업이 있지만 생성 사용자는 시스템 계정입니다.", evidence: ["동일 시간대 회계 담당자의 조회 이력"],
        counterEvidence: ["전표 생성 사용자가 배치 계정", "수동 저장 이력 없음"], nextChecks: ["임시 전표 저장·삭제 이력"] },
      { title: "점포 코드 매핑 오류", confidence: "낮음", score: 21,
        summary: "금액 이동이 아닌 동일 원천번호 중복이므로 가능성이 낮습니다.", evidence: ["두 거래가 동일 점포"],
        counterEvidence: ["점포별 합계와 코드가 모두 일치", "마스터 변경 없음"], nextChecks: ["원천 거래번호와 점포 코드 조합"] },
    ],
    recommendedOwner: "최ERP", recommendedTeam: "ERP 인터페이스 운영팀",
    requestMessage: "7월 15일 정산과 ERP 총액은 일치하지만 ERP 전표 구성에서 POS-0715-0064가 누락되고 POS-0715-0065가 중복 생성됐습니다. 두 거래 금액은 각각 1,000,000원이며 동일 재처리 배치에서 발생했습니다. 전표 생성 멱등성 키와 재처리 대상 선정 조건을 확인하고 중복 전표 취소 후 누락 거래를 재처리해 주세요.",
    incidents: [
      { transactionId: "POS-0715-0064", store: "역삼점", cardCompany: "삼성카드", amount: 1_000_000, approvedAt: "18:42:18", batchId: "ERP-RETRY-0717-01", state: "ERP 누락" },
      { transactionId: "POS-0715-0065", store: "역삼점", cardCompany: "삼성카드", amount: 1_000_000, approvedAt: "18:43:02", batchId: "ERP-RETRY-0717-01", state: "ERP 중복" },
    ], resolvedFlow: healthyFlow(),
  },
];

export const getScenario = (id: string) => scenarios.find((scenario) => scenario.id === id) ?? scenarios[0];
export const formatWon = (value: number) => `${value.toLocaleString("ko-KR")}원`;
