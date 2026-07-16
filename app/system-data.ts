import type { Scenario, StageStatus } from "./scenarios";

export type SystemKey = "pos" | "van" | "card" | "settlement" | "bank" | "erp";
export type TraceSource = "erp" | "mismatch" | "system";

export type DataRow = {
  id: string;
  values: Array<string | number>;
  state: "normal" | "waiting" | "review" | "error";
  traceRef: string;
};

export type SystemDataset = {
  key: SystemKey;
  label: string;
  english: string;
  description: string;
  totalCount: number;
  totalAmount: number;
  receivedAt: string;
  columns: string[];
  rows: DataRow[];
  gap: number;
  gapLabel: string;
};

export type MismatchRecord = {
  id: string;
  title: string;
  source: string;
  target: string;
  count: number;
  amount: number;
  firstGap: string;
  status: "정상 지연" | "확인 필요" | "미처리" | "처리 중";
  detectedAt: string;
  traceRef: string;
};

const sampleAmounts = [1_200_000, 850_000, 1_350_000, 600_000, 1_000_000];
const stores = ["강남점", "강남점", "역삼점", "본점", "강남점"];
const cards = ["신한카드", "신한카드", "삼성카드", "KB국민카드", "신한카드"];
const times = ["22:42:10", "22:43:18", "22:44:26", "22:45:03", "22:46:11"];

const stageState = (status: StageStatus): DataRow["state"] => status;
const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export function buildSystemDatasets(scenario: Scenario): SystemDataset[] {
  const stages = Object.fromEntries(scenario.flow.map((item) => [item.id, item]));
  const posRows: DataRow[] = sampleAmounts.map((amount, index) => ({
    id: `POS-0715-${String(41 + index).padStart(4, "0")}`,
    traceRef: `POS-0715-${String(41 + index).padStart(4, "0")}`,
    state: "normal",
    values: [`POS-0715-${String(41 + index).padStart(4, "0")}`, stores[index], `POS-0${(index % 3) + 1}`, times[index], "카드", won(amount), "정상"],
  }));
  const vanRows: DataRow[] = sampleAmounts.map((amount, index) => ({
    id: `VAN-0715-${String(41 + index).padStart(4, "0")}`,
    traceRef: `POS-0715-${String(41 + index).padStart(4, "0")}`,
    state: "normal",
    values: [`VAN-0715-${String(41 + index).padStart(4, "0")}`, `POS-0715-${String(41 + index).padStart(4, "0")}`, `30012${341 + index}`, cards[index], times[index], won(amount), "00 · 승인"],
  }));
  const cardRows: DataRow[] = sampleAmounts.slice(0, scenario.flow[2].count < 100 ? 3 : 5).map((amount, index) => ({
    id: `ACQ-0716-${String(31 + index).padStart(4, "0")}`,
    traceRef: `POS-0715-${String(41 + index).padStart(4, "0")}`,
    state: "normal",
    values: [`ACQ-0716-${String(31 + index).padStart(4, "0")}`, `30012${341 + index}`, cards[index], `07-16 01:${20 + index}`, "1.70%", won(Math.round(amount * .983)), "매입 완료"],
  }));
  const settlementRows: DataRow[] = sampleAmounts.slice(0, scenario.flow[3].count < 100 ? 3 : 5).map((amount, index) => ({
    id: `SET-0716-${String(21 + index).padStart(4, "0")}`,
    traceRef: `POS-0715-${String(41 + index).padStart(4, "0")}`,
    state: stageState(scenario.flow[3].status),
    values: [`SET-0716-${String(21 + index).padStart(4, "0")}`, `ACQ-0716-${String(31 + index).padStart(4, "0")}`, "SETTLE-0715-03", "07-17", won(Math.round(amount * .983)), scenario.flow[3].status === "normal" ? "정산 확정" : "일부 대기"],
  }));
  const bankRows: DataRow[] = sampleAmounts.slice(0, 4).map((amount, index) => ({
    id: `DEP-0717-${String(11 + index).padStart(4, "0")}`,
    traceRef: `POS-0715-${String(41 + index).padStart(4, "0")}`,
    state: stageState(scenario.flow[4].status),
    values: [`DEP-0717-${String(11 + index).padStart(4, "0")}`, `SET-0716-${String(21 + index).padStart(4, "0")}`, "국민 123-456-789012", "07-17 09:12", won(Math.round(amount * .983)), scenario.flow[4].status === "normal" ? "정상 입금" : "입금 예정"],
  }));
  const settlementSourceCount = stages.settlement.count;
  const erpGross = stages.card.amount;
  const erpFee = erpGross - stages.settlement.amount;
  const erpRows: DataRow[] = [
    {
      id: "JV-20260716-9001", traceRef: "JV-20260716-9001", state: scenario.id === "offsetting-errors" ? "error" : "normal",
      values: ["JV-20260716-9001", "07-15 · 강남점 · 신한카드", "3개", `${settlementSourceCount}건`, won(erpGross), won(erpFee), won(stages.settlement.amount), scenario.id === "offsetting-errors" ? "원천 구성 불일치" : "전표 검증 정상"],
    },
    ...sampleAmounts.slice(0, 4).map((amount, index): DataRow => ({
      id: `JV-20260716-${String(120 + index).padStart(4, "0")}`, traceRef: `POS-0715-${String(31 + index).padStart(4, "0")}`, state: "normal",
      values: [`JV-20260716-${String(120 + index).padStart(4, "0")}`, `${["07-15 · 강남점 · 삼성카드", "07-15 · 강남점 · KB국민", "07-15 · 역삼점 · 신한카드", "07-15 · 본점 · 롯데카드"][index]}`, "3개", `${[12, 8, 15, 10][index]}건`, won(amount), won(Math.round(amount * .017)), won(Math.round(amount * .983)), "전표 검증 정상"],
    })),
  ];

  const configs: Array<Omit<SystemDataset, "totalCount" | "totalAmount" | "gap" | "gapLabel"> & { stageId: string }> = [
    { key: "pos", stageId: "pos", label: "POS", english: "Point of Sale", description: "점포에서 발생한 카드·현금 판매 원천 데이터", receivedAt: "07-16 00:05", columns: ["POS 거래번호", "점포", "단말기", "거래시간", "결제수단", "금액", "상태"], rows: posRows },
    { key: "van", stageId: "van", label: "VAN", english: "Authorization Gateway", description: "POS 승인 요청과 카드사 승인 응답 중계 데이터", receivedAt: "07-16 00:08", columns: ["VAN 요청번호", "POS 거래번호", "승인번호", "카드사", "승인시간", "승인금액", "응답"], rows: vanRows },
    { key: "card", stageId: "card", label: "카드사", english: "Acquisition", description: "승인 거래의 매입 확정, 수수료 및 정산 대상 데이터", receivedAt: "07-16 01:35", columns: ["매입번호", "승인번호", "카드사", "매입시간", "수수료율", "정산 예정액", "상태"], rows: cardRows },
    { key: "settlement", stageId: "settlement", label: "정산", english: "Settlement", description: "카드사별 지급 예정액과 정산 배치 처리 데이터", receivedAt: "07-16 02:10", columns: ["정산번호", "매입번호", "배치번호", "입금예정일", "정산 예정액", "상태"], rows: settlementRows },
    { key: "bank", stageId: "bank", label: "은행", english: "Bank Deposit", description: "정산 예정액에 대응하는 실제 입금 및 계좌 데이터", receivedAt: "07-17 09:20", columns: ["입금번호", "정산번호", "입금계좌", "입금일시", "실제 입금액", "상태"], rows: bankRows },
    { key: "erp", stageId: "erp", label: "ERP", english: "Accounting Journal", description: "정산 원천을 회계 기준으로 묶어 생성한 전표 헤더와 분개 데이터", receivedAt: "07-16 03:30", columns: ["전표번호", "집계 기준", "전표 라인", "연결 원천", "총매출", "수수료", "입금예정액", "검증 결과"], rows: erpRows },
  ];

  return configs.map((config, index) => {
    const current = stages[config.stageId];
    const previous = index === 0 ? current : stages[configs[index - 1].stageId];
    if (config.key === "erp") {
      return {
        ...config,
        totalCount: config.rows.length,
        totalAmount: current.amount,
        gap: scenario.id === "offsetting-errors" ? 1 : 0,
        gapLabel: scenario.id === "offsetting-errors"
          ? `원천 연결률 ${Math.max(0, stages.settlement.count - 1)}/${stages.settlement.count} · 중복 1건`
          : `선택 전표가 정산 원천 ${stages.settlement.count}건을 집계`,
      };
    }
    const gap = Math.max(0, previous.count - current.count);
    return { ...config, totalCount: current.count, totalAmount: current.amount, gap, gapLabel: gap > 0 ? `이전 단계 대비 ${gap}건 부족` : "이전 단계와 연결 완료" };
  });
}

export function buildMismatchRecords(scenario: Scenario): MismatchRecord[] {
  return [
    { id: "INC-2026-0716-003", title: scenario.eventTitle, source: scenario.divergence.split(" → ")[0], target: scenario.divergence.split(" → ")[1] ?? "ERP", count: scenario.impactCount, amount: scenario.impactAmount, firstGap: scenario.divergence, status: scenario.classification === "정상 지연" ? "정상 지연" : "확인 필요", detectedAt: "07-16 11:42", traceRef: "JV-20260716-9001" },
    { id: "INC-2026-0716-002", title: "은행 실제 입금액이 정산 예정액보다 적습니다", source: "정산", target: "은행", count: 3, amount: 1_250_000, firstGap: "정산 → 은행", status: "처리 중", detectedAt: "07-16 10:18", traceRef: "DEP-0716-0021" },
    { id: "INC-2026-0716-001", title: "신규 점포 매출이 다른 점포 코드로 반영됐습니다", source: "POS", target: "ERP", count: 12, amount: 8_430_000, firstGap: "정산 → ERP", status: "미처리", detectedAt: "07-16 09:50", traceRef: "JV-20260716-0088" },
    { id: "INC-2026-0715-011", title: "취소 거래가 다음 정산 주기로 넘어갔습니다", source: "카드사", target: "정산", count: 2, amount: 430_000, firstGap: "카드사 → 정산", status: "정상 지연", detectedAt: "07-15 17:28", traceRef: "SET-0715-0014" },
  ];
}

export function buildTraceRows(scenario: Scenario) {
  return scenario.flow.map((stage, index) => ({
    system: stage.name,
    documentId: ["POS-0715-0041 외 99건", "APR-30012341 외 99건", stage.count < 100 ? `ACQ 95건 · 미연결 ${scenario.impactCount}건` : "ACQ-0716-0031 외 99건", stage.count < 100 ? "SET-0716-0021 외 94건" : "SET-0716-0021 외 99건", "DEP-0717-0011 외 입금묶음", "JV-20260716-9001"][index],
    linkKey: ["POS_TXN_ID", "POS_TXN_ID + 승인번호", "승인번호", "매입번호 + 배치번호", "정산번호 + 입금참조", "정산번호 + 점포코드"][index],
    amount: stage.amount,
    timestamp: stage.timestamp,
    status: stage.status,
    detail: stage.detail,
  }));
}
