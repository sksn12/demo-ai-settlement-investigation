import type { Scenario, StageStatus } from "./scenarios";

export type SystemKey = "pos" | "van" | "card" | "settlement" | "erp";
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
    id: `POS-0630-${String(41 + index).padStart(4, "0")}`,
    traceRef: `POS-0630-${String(41 + index).padStart(4, "0")}`,
    state: "normal",
    values: [`POS-0630-${String(41 + index).padStart(4, "0")}`, "2026-06-30", stores[index], `POS-0${(index % 3) + 1}`, times[index], "카드", won(amount), "정상"],
  }));
  const vanRows: DataRow[] = sampleAmounts.map((amount, index) => ({
    id: `VAN-0630-${String(41 + index).padStart(4, "0")}`,
    traceRef: `POS-0630-${String(41 + index).padStart(4, "0")}`,
    state: "normal",
    values: [`VAN-0630-${String(41 + index).padStart(4, "0")}`, `POS-0630-${String(41 + index).padStart(4, "0")}`, "2026-06-30", times[index], `30012${341 + index}`, cards[index], won(amount), "00 · 승인"],
  }));
  const cardRows: DataRow[] = sampleAmounts.slice(0, scenario.flow[2].count < 100 ? 3 : 5).map((amount, index) => ({
    id: `ACQ-0703-${String(31 + index).padStart(4, "0")}`,
    traceRef: `POS-0630-${String(41 + index).padStart(4, "0")}`,
    state: "normal",
    values: [`ACQ-0703-${String(31 + index).padStart(4, "0")}`, `30012${341 + index}`, cards[index], "2026-07-01", `01:${20 + index}:00`, "1.70%", won(Math.round(amount * .983)), "매입 완료"],
  }));
  const settlementRows: DataRow[] = sampleAmounts.slice(0, scenario.flow[3].count < 100 ? 3 : 5).map((amount, index) => ({
    id: `SET-0703-${String(21 + index).padStart(4, "0")}`,
    traceRef: `POS-0630-${String(41 + index).padStart(4, "0")}`,
    state: stageState(scenario.flow[3].status),
    values: [`SET-0703-${String(21 + index).padStart(4, "0")}`, `ACQ-0703-${String(31 + index).padStart(4, "0")}`, "SETTLE-0630-03", "07-02", won(Math.round(amount * .983)), scenario.flow[3].status === "normal" ? "정산 확정" : "일부 대기"],
  }));
  const settlementSourceCount = stages.settlement.count;
  const erpGross = stages.card.amount;
  const erpFee = erpGross - stages.settlement.amount;
  const erpRows: DataRow[] = [
    {
      id: "JV-20260703-9001", traceRef: "JV-20260703-9001", state: scenario.id === "offsetting-errors" ? "error" : "normal",
      values: ["JV-20260703-9001", "2026-06-01 ~ 2026-06-30", "강남점", "신한카드", "월마감", `${settlementSourceCount}건`, won(erpGross), won(erpFee), won(stages.settlement.amount), scenario.id === "offsetting-errors" ? "원천 구성 불일치" : "전표 검증 정상"],
    },
    ...sampleAmounts.slice(0, 4).map((amount, index): DataRow => ({
      id: `JV-20260703-${String(120 + index).padStart(4, "0")}`, traceRef: `POS-0630-${String(31 + index).padStart(4, "0")}`, state: "normal",
      values: [`JV-20260703-${String(120 + index).padStart(4, "0")}`, "2026-06-01 ~ 2026-06-30", ["강남점", "강남점", "역삼점", "본점"][index], ["삼성카드", "KB국민카드", "신한카드", "롯데카드"][index], index === 3 ? "주마감" : "월마감", `${[12, 8, 15, 10][index]}건`, won(amount), won(Math.round(amount * .017)), won(Math.round(amount * .983)), "전표 검증 정상"],
    })),
  ];

  const configs: Array<Omit<SystemDataset, "totalCount" | "totalAmount" | "gap" | "gapLabel"> & { stageId: string }> = [
    { key: "pos", stageId: "pos", label: "POS", english: "Point of Sale", description: "점포 영업일 기준 카드 매출·취소 원천 데이터", receivedAt: "07-01 00:05", columns: ["POS 거래번호", "영업일", "점포", "단말기", "거래시각", "결제수단", "금액", "상태"], rows: posRows },
    { key: "van", stageId: "van", label: "VAN 승인", english: "Authorization Gateway", description: "POS 요청과 카드사 승인·취소 응답 중계 데이터", receivedAt: "07-01 00:08", columns: ["VAN 요청번호", "POS 거래번호", "승인일자", "승인시각", "승인번호", "카드사", "승인금액", "응답"], rows: vanRows },
    { key: "card", stageId: "card", label: "카드사 매입", english: "Acquisition", description: "승인 거래의 매입·취소 확정과 수수료 기준 데이터", receivedAt: "07-01 01:35", columns: ["매입번호", "승인번호", "카드사", "매입일자", "매입시각", "수수료율", "정산 예정액", "상태"], rows: cardRows },
    { key: "settlement", stageId: "settlement", label: "정산시스템", english: "Settlement", description: "카드사별 지급 예정액과 정산 배치 처리 데이터", receivedAt: "07-02 02:10", columns: ["정산번호", "매입번호", "배치번호", "정산일자", "정산 예정액", "상태"], rows: settlementRows },
    { key: "erp", stageId: "erp", label: "ERP 전표", english: "Accounting Journal", description: "여러 정산 원천을 회사 집계 규칙으로 묶은 전표 헤더", receivedAt: "07-03 09:30", columns: ["전표번호", "대상 기간", "점포", "카드사", "집계주기", "연결 원천", "총매출", "수수료", "정산액", "검증 결과"], rows: erpRows },
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
    { id: "INC-2026-0703-003", title: scenario.eventTitle, source: scenario.divergence.split(" → ")[0], target: scenario.divergence.split(" → ")[1] ?? "ERP", count: scenario.impactCount, amount: scenario.impactAmount, firstGap: scenario.divergence, status: scenario.classification === "정상 지연" ? "정상 지연" : "확인 필요", detectedAt: "07-01 11:42", traceRef: "JV-20260703-9001" },
    { id: "INC-2026-0703-002", title: "카드 승인 취소 3건이 POS 매출에서 차감되지 않았습니다", source: "POS", target: "VAN 취소", count: 3, amount: 3_000_000, firstGap: "POS 매출 ↔ VAN 취소", status: "처리 중", detectedAt: "07-03 09:18", traceRef: "POS-0630-0032" },
    { id: "INC-2026-0702-011", title: "6월 승인 거래가 7월 카드사 매입으로 연결됐습니다", source: "VAN 승인", target: "카드사 매입", count: 5, amount: 5_000_000, firstGap: "승인일 ↔ 매입일", status: "정상 지연", detectedAt: "07-02 10:05", traceRef: "POS-0630-0096" },
    { id: "INC-2026-0702-007", title: "월말 원거래가 다음 달 취소·타 카드 재결제로 연결됐습니다", source: "POS", target: "ERP", count: 2, amount: 2_000_000, firstGap: "월말 원거래 → 다음 달 조정", status: "미처리", detectedAt: "07-02 09:48", traceRef: "POS-0630-0088" },
  ];
}

export function buildTraceRows(scenario: Scenario) {
  return scenario.flow.map((stage, index) => ({
    system: stage.name,
    documentId: ["POS-202606 외 99건", "APR-202606 외 99건", stage.count < 100 ? `ACQ 95건 · 미연결 ${scenario.impactCount}건` : "ACQ-202607 외 99건", stage.count < 100 ? "SET-202606-M01 외 94건" : "SET-202606-M01 외 99건", "JV-20260703-9001 · 월마감 1전표"][index],
    linkKey: ["POS_TXN_ID", "POS_TXN_ID + 승인번호", "승인번호", "매입번호 + 배치번호", "정산배치 + 점포코드 + 카드사"][index],
    amount: stage.amount,
    timestamp: stage.timestamp,
    status: stage.status,
    detail: stage.detail,
  }));
}
