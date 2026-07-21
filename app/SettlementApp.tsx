"use client";

import { useEffect, useState } from "react";
import { formatWon, getScenario, scenarios, type FlowStage, type Scenario, type StageStatus } from "./scenarios";
import { useSettlementStore, type AppView } from "./settlement-store";
import { buildMismatchRecords, buildSystemDatasets, buildTraceRows, type SystemKey } from "./system-data";

const navSections: Array<{ label: string; items: Array<{ id: AppView; label: string; icon: string; help: string }> }> = [
  { label: "대사 업무", items: [
    { id: "dashboard", label: "정산 업무 홈", icon: "⌂", help: "마감·예외·할 일" },
    { id: "mismatches", label: "대사 예외함", icon: "!", help: "미결·미연결 거래" },
  ] },
  { label: "조회 및 검증", items: [
    { id: "erp", label: "ERP 전표 검증", icon: "V", help: "예상 전표와 비교" },
    { id: "trace", label: "거래·전표 추적", icon: "↔", help: "원천 연결 관계" },
    { id: "systemData", label: "원천 데이터 조회", icon: "D", help: "POS·VAN·카드·정산·ERP" },
  ] },
  { label: "조사 및 처리", items: [
    { id: "investigation", label: "원인 조사 지원", icon: "AI", help: "원인 후보·담당 부서" },
    { id: "resolution", label: "업무 처리", icon: "✓", help: "배정·재처리·검증" },
    { id: "history", label: "처리·감사 이력", icon: "H", help: "조치 근거와 변경 기록" },
  ] },
];
const navItems = navSections.flatMap((section) => section.items);

const guideSteps: Array<{ view: AppView; target: string; label: string; title: string; description: string; takeaway: string }> = [
  { view: "dashboard", target: "home-kpis", label: "업무 시작", title: "마감 기간의 대사 예외를 먼저 봅니다", description: "회계 담당자는 전체 전표를 훑는 대신 기간별 마감 진행률과 미결 예외부터 확인합니다.", takeaway: "6월 우선 업무는 미결 대사 예외 4건입니다." },
  { view: "dashboard", target: "flow-divergence", label: "자동 감지", title: "승인 100건 중 매입 95건만 반영됐습니다", description: "POS와 VAN까지는 정상이고 카드사 매입부터 5건이 부족합니다. 시스템은 카드사별 정상 대기시간이 지난 뒤 사건을 생성합니다.", takeaway: "최초 이상 구간은 VAN 승인 → 카드사 매입입니다." },
  { view: "mismatches", target: "exception-inbox", label: "예외 접수", title: "자동 감지된 사건이 대사 예외함에 들어옵니다", description: "전표가 없거나 아직 연결되지 않은 사건도 이 목록에서 함께 관리합니다. 담당자는 영향 금액과 마감 시각으로 우선순위를 정합니다.", takeaway: "전체 데이터가 아니라 예외 사건만 조사합니다." },
  { view: "trace", target: "transaction-trace", label: "거래 추적", title: "문제가 처음 발생한 시스템 구간을 확인합니다", description: "각 시스템의 문서번호와 연결 키를 따라 POS부터 ERP까지 전달 상태를 비교합니다.", takeaway: "ERP의 1전표·3라인은 95개 원천을 묶은 정상 집계입니다." },
  { view: "erp", target: "journal-validation", label: "전표 검증", title: "월마감 전표의 포함 매출을 일자별로 확인합니다", description: "전표 건수를 이전 단계 건수와 비교하지 않고, 전표가 묶은 기간·점포·카드사와 원천 연결률을 검증합니다.", takeaway: "한 전표가 여러 매출을 묶으며, 이상 일자에서 거래까지 내려갑니다." },
  { view: "investigation", target: "ai-investigation", label: "AI 조사", title: "AI가 원인 후보와 확인 순서를 정리합니다", description: "AI는 원인을 단정하지 않고 거래시간, 배치 로그, 반대 근거와 추가 확인 항목을 함께 보여줍니다.", takeaway: "1순위는 VAN 매입 전송 배치의 부분 실패입니다." },
  { view: "resolution", target: "case-resolution", label: "업무 처리", title: "추천 담당자에게 근거와 함께 조사를 요청합니다", description: "담당자를 배정하고 요청문을 만든 뒤 재처리 결과를 같은 대사 규칙으로 다시 검증합니다.", takeaway: "회계 담당자는 판단과 승인에 집중합니다." },
  { view: "history", target: "audit-history", label: "감사 이력", title: "확정 원인과 조치 결과를 다음 조사에 남깁니다", description: "누가 어떤 근거로 판단하고 무엇을 변경했는지 보존해 유사 사건의 추천 품질을 높입니다.", takeaway: "자동 감지부터 정상화까지 하나의 사건 이력으로 연결됩니다." },
];

const statusLabel: Record<StageStatus, string> = {
  normal: "정상", waiting: "대기", review: "확인 필요", error: "오류",
};

const downloadCsv = (filename: string, headers: string[], rows: Array<Array<string | number>>) => {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadTransactions = (scenario: Scenario) => downloadCsv(
  `카드매출_대사예외_${scenario.id}.csv`,
  ["POS 거래번호", "점포", "카드사", "POS 영업일", "승인일자", "승인시각", "승인번호", "매입일자", "정산일자", "회계일자", "금액", "배치번호", "상태"],
  scenario.incidents.map((row) => [
    row.transactionId, row.store, row.cardCompany, row.businessDate ?? "2026-06-30",
    row.approvalDate ?? "2026-06-30", row.approvedAt, row.approvalNo ?? `30${row.transactionId.slice(-5)}`,
    row.acquisitionDate ?? (row.state.includes("대기") || row.state.includes("재시도") ? "미반영" : "2026-07-01"),
    row.settlementDate ?? (row.state.includes("대기") || row.state.includes("재시도") ? "미반영" : "2026-07-02"),
    row.accountingDate ?? "2026-06-30", row.amount, row.batchId, row.state,
  ]),
);
export function SettlementApp() {
  const view = useSettlementStore((state) => state.view);
  const setView = useSettlementStore((state) => state.setView);

  const scenarioId = useSettlementStore((state) => state.scenarioId);
  const resetDemo = useSettlementStore((state) => state.resetDemo);
  const guideActive = useSettlementStore((state) => state.guideActive);
  const guideStep = useSettlementStore((state) => state.guideStep);
  const startGuide = useSettlementStore((state) => state.startGuide);
  const nextGuide = useSettlementStore((state) => state.nextGuide);
  const previousGuide = useSettlementStore((state) => state.previousGuide);
  const endGuide = useSettlementStore((state) => state.endGuide);
  const scenario = getScenario(scenarioId);
  const currentGuide = guideSteps[guideStep] ?? guideSteps[0];

  useEffect(() => {
    if (!guideActive) return;
    setView(currentGuide.view);
    const timer = window.setTimeout(() => document.querySelector(`[data-tour="${currentGuide.target}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(timer);
  }, [currentGuide.target, currentGuide.view, guideActive, guideStep, setView]);

  return (
    <div className={`app-shell ${guideActive ? "guide-active" : ""}`} data-guide-step={guideActive ? guideStep : undefined}>
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => setView("dashboard")} aria-label="정산 업무 홈으로 이동">
          <span className="brand-mark">F</span>
          <span><strong>FlowScope</strong><small>AI settlement ops</small></span>
        </button>
        <nav className="main-nav" aria-label="주요 화면">
          {navSections.map((section) => <div className="nav-section" key={section.label}>
            <div className="sidebar-caption">{section.label}</div>
            {section.items.map((item) => (
              <button key={item.id} type="button" className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}>
                <span className="nav-number">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.help}</small></span>
              </button>
            ))}
          </div>)}
        </nav>
        <div className="sidebar-foot">
          <div className="demo-signal"><span /> 데모 데이터 사용 중</div>
          <p>{scenario.label}</p>
          <button className="guide-start-button" type="button" onClick={startGuide}><span>▶</span> 업무 흐름 데모</button>
          <button className="text-button" type="button" onClick={() => setView("lab")}>데모 상황 변경</button>
          <button className="text-button muted-action" type="button" onClick={resetDemo}>초기화</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="topbar-path">정산 운영 <span>/</span> {navItems.find((item) => item.id === view)?.label ?? "데모 설정"}</p>
          </div>
          <div className="topbar-actions">
            <label className="global-search"><span>⌕</span><input aria-label="통합 검색" placeholder="거래번호·승인번호·전표번호 검색" /></label>
            <div className="date-chip">대사 기간 2026-06-01 ~ 06-30</div>
            <button className="notification-button" type="button" aria-label="알림 3건">3</button>
            <button className="avatar" type="button" aria-label="사용자 메뉴">회</button>
          </div>
        </header>

        <div className="page-body">
          {view === "guide" && <GuidePage onStart={() => setView("dashboard")} />}
          {view === "lab" && <ScenarioLab />}
          {view === "dashboard" && <Dashboard scenario={scenario} />}
          {view === "systemData" && <SystemDataPage scenario={scenario} />}
          {view === "erp" && <ErpVournalPage scenario={scenario} />}
          {view === "mismatches" && <MismatchPage scenario={scenario} />}
          {view === "trace" && <TracePage scenario={scenario} />}
          {view === "investigation" && <Investigation scenario={scenario} />}
          {view === "resolution" && <Resolution scenario={scenario} />}
          {view === "history" && <FullHistoryPage scenario={scenario} />}
        </div>
      </main>
      {guideActive && <GuidedTourPanel step={guideStep} current={currentGuide} onPrevious={previousGuide} onNext={nextGuide} onEnd={endGuide} />}
    </div>
  );
}

function GuidedTourPanel({ step, current, onPrevious, onNext, onEnd }: { step: number; current: (typeof guideSteps)[number]; onPrevious: () => void; onNext: () => void; onEnd: () => void }) {
  const isLast = step === guideSteps.length - 1;
  return (
    <aside className="guided-tour" aria-live="polite" aria-label="업무 흐름 가이드">
      <div className="tour-progress"><span style={{ width: `${((step + 1) / guideSteps.length) * 100}%` }} /></div>
      <div className="tour-head"><div><small>GUIDED WORKFLOW</small><strong>{current.label}</strong></div><button type="button" onClick={onEnd} aria-label="가이드 종료">×</button></div>
      <div className="tour-body"><span className="tour-step">STEP {step + 1}</span><h2>{current.title}</h2><p>{current.description}</p><div className="tour-takeaway"><span>지금 볼 것</span><strong>{current.takeaway}</strong></div></div>
      <div className="tour-actions"><button className="tour-secondary" type="button" onClick={onPrevious} disabled={step === 0}>이전</button><span>{step + 1} / {guideSteps.length}</span><button className="tour-primary" type="button" onClick={isLast ? onEnd : onNext}>{isLast ? "데모 종료" : "다음"}</button></div>
    </aside>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

function GuidePage({ onStart }: { onStart: () => void }) {
  const flow = [
    ["POS", "판매를 기록", "거래번호 · 점포 · 금액"], ["VAN", "승인을 중계", "승인번호 · 응답코드"],
    ["카드사", "매입을 확정", "매입상태 · 수수료"], ["정산", "받을 돈을 계산", "정산번호 · 예정액"],
    ["ERP", "여러 거래를 묶어 기록", "전표번호 · 대상기간 · 회계일자"],
  ];
  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-badge">TEAM ONBOARDING</span>
          <h1>숫자가 다른 이유보다,<br/><em>어디부터 확인할지</em> 먼저 찾습니다.</h1>
          <p>FlowScope AI는 POS부터 ERP까지 거래 흐름을 연결하고, 같은 불일치를 만들 수 있는 여러 원인 중 조사 우선순위와 담당자를 제안합니다.</p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={onStart}>시나리오로 이해하기 <span>→</span></button>
            <div className="hero-stat"><strong>5</strong><span>연결 시스템</span></div>
            <div className="hero-stat"><strong>5</strong><span>대표 시나리오</span></div>
          </div>
        </div>
        <div className="hero-visual" aria-label="AI 조사 과정">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="ai-core"><span>AI</span><strong>조사 우선순위</strong><small>근거 · 담당자 · 다음 행동</small></div>
          <div className="floating-note note-one"><span>01</span>최초 이상 구간</div>
          <div className="floating-note note-two"><span>02</span>원인 후보 비교</div>
          <div className="floating-note note-three"><span>03</span>업무 요청 생성</div>
        </div>
      </section>

      <section className="content-card flow-guide-card">
        <div className="section-title"><div><span className="section-kicker">PAYMENT FLOW</span><h2>한 건의 결제가 회계 데이터가 되기까지</h2></div><p>각 단계의 숫자와 거래 구성을 함께 비교합니다.</p></div>
        <div className="guide-flow">
          {flow.map(([name, role, data], index) => (
            <div className="guide-stage" key={name}>
              <div className="guide-stage-head"><span>{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong></div>
              <p>{role}</p><small>{data}</small>
              {index < flow.length - 1 && <i>→</i>}
            </div>
          ))}
        </div>
      </section>

      <section className="responsibility-grid">
        <article className="role-card rule"><span className="role-icon">R</span><div><small>RULE ENGINE</small><h3>규칙이 찾는 것</h3><p>건수·금액 비교, 누락 거래 특정, 최초 불일치 구간 탐지</p></div></article>
        <article className="role-card ai"><span className="role-icon">AI</span><div><small>AI INVESTIGATOR</small><h3>AI가 제안하는 것</h3><p>원인 후보, 판단 근거, 조사 우선순위, 먼저 확인할 담당자</p></div></article>
        <article className="role-card human"><span className="role-icon">H</span><div><small>HUMAN DECISION</small><h3>사람이 결정하는 것</h3><p>실제 원인 확인, 수정 승인, 재처리 및 사건 종료</p></div></article>
      </section>
    </div>
  );
}

function ScenarioLab() {
  const scenarioId = useSettlementStore((state) => state.scenarioId);
  const selectScenario = useSettlementStore((state) => state.selectScenario);
  const runScenario = useSettlementStore((state) => state.runScenario);
  const selected = getScenario(scenarioId);
  return (
    <div className="page-stack">
      <PageHeading eyebrow="SCENARIO LAB" title="같은 증상을 서로 다른 원인으로 만들어보세요" description="실제 데이터를 생성하지 않고, 준비된 시나리오 상태를 전체 화면에 적용합니다." />
      <div className="lab-layout">
        <section className="scenario-list" aria-label="시나리오 선택">
          {scenarios.map((scenario, index) => (
            <button type="button" key={scenario.id} onClick={() => selectScenario(scenario.id)} className={`scenario-card ${scenarioId === scenario.id ? "selected" : ""} ${scenario.tone}`} aria-pressed={scenarioId === scenario.id}>
              <div className="scenario-card-top"><span className="scenario-index">0{index + 1}</span><span className={`tone-dot ${scenario.tone}`} /></div>
              <small>{scenario.eyebrow}</small><h3>{scenario.label}</h3><p>{scenario.description}</p>
              <div className="scenario-meta"><span>영향 {scenario.impactCount}건</span><span>{formatWon(scenario.impactAmount)}</span></div>
            </button>
          ))}
        </section>
        <aside className="lab-preview content-card">
          <div className="preview-head"><span className={`status-pill ${selected.tone}`}>{selected.classification}</span><small>선택된 시나리오</small></div>
          <h2>{selected.eventTitle}</h2><p>{selected.eventSummary}</p>
          <div className="mini-flow">
            {selected.flow.map((item, index) => (
              <div key={item.id} className={`mini-stage ${item.status}`}><span>{item.short}</span><strong>{item.count}건</strong>{index < selected.flow.length - 1 && <i>→</i>}</div>
            ))}
          </div>
          <div className="preview-facts">
            <div><small>최초 이상 구간</small><strong>{selected.divergence}</strong></div>
            <div><small>예상 담당 영역</small><strong>{selected.recommendedTeam}</strong></div>
          </div>
          <button type="button" className="primary-button full" onClick={runScenario}>이 시나리오 실행하기 <span>→</span></button>
        </aside>
      </div>
      <div className="compare-note"><span>핵심 비교</span><p><strong>정상적인 매입 지연</strong>과 <strong>배치 부분 실패</strong>는 건수와 금액이 같지만, 거래시간·배치 로그에 따라 AI의 조사 우선순위가 달라집니다.</p></div>
    </div>
  );
}

function FlowStrip({ stages, compact = false }: { stages: FlowStage[]; compact?: boolean }) {
  return (
    <div className={`system-flow ${compact ? "compact" : ""}`}>
      {stages.map((item, index) => (
        <div className="flow-stage-wrap" key={item.id}>
          <div className={`flow-stage ${item.status}`}>
            <div className="stage-top"><span className="stage-symbol">{item.short}</span><span className={`stage-status ${item.status}`}>{statusLabel[item.status]}</span></div>
            <small>{item.role}</small><h3>{item.name}</h3>
            <div className="stage-numbers">
              <strong>{item.id === "erp" ? "1전표 · 3라인" : `${item.count.toLocaleString()}건`}</strong>
              <span>{item.id === "erp" ? `원천 ${item.count.toLocaleString()}건 · ${formatWon(item.amount)}` : formatWon(item.amount)}</span>
            </div>
            {!compact && <p>{item.detail}</p>}
          </div>
          {index < stages.length - 1 && <div className={`flow-arrow ${stages[index + 1].status === "error" ? "break" : ""}`}>→</div>}
        </div>
      ))}
    </div>
  );
}

function Dashboard({ scenario }: { scenario: Scenario }) {
  const openTrace = useSettlementStore((state) => state.openTrace);
  const [periodMode, setPeriodMode] = useState<"일" | "주" | "월" | "직접 선택">("월");
  const reconciliationRows = [
    { date: "06-28", card: "신한카드", pos: 82_400_000, van: 82_400_000, acquired: 82_400_000, settled: 81_000_000, erp: 81_000_000, gap: 0, status: "정상" },
    { date: "06-29", card: "신한카드", pos: 94_600_000, van: 94_600_000, acquired: 94_600_000, settled: 92_992_000, erp: 92_992_000, gap: 0, status: "정상" },
    { date: "06-30", card: "신한카드", pos: 100_000_000, van: 100_000_000, acquired: scenario.flow[2].amount, settled: scenario.flow[3].amount, erp: scenario.flow[4].amount, gap: scenario.impactAmount, status: scenario.classification },
    { date: "07-01 이월", card: "신한카드", pos: 5_000_000, van: 5_000_000, acquired: scenario.id === "normal-delay" ? 5_000_000 : 0, settled: 0, erp: 0, gap: scenario.id === "normal-delay" ? 0 : 5_000_000, status: scenario.id === "normal-delay" ? "정상 시차" : "확인 필요" },
  ];

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CARD SALES RECONCILIATION" title="카드매출 대사 업무" description="선택한 기간의 마감 현황과 우선 조사할 예외를 확인합니다."
        actions={<><span className="updated-at">마지막 갱신 07-03 09:42</span><button className="secondary-button" type="button">새로고침</button></>} />

      <section className="period-control content-card">
        <div><span className="section-kicker">RECONCILIATION PERIOD</span><h2>대사 기간</h2><p>회사 마감 규칙에 따라 일·주·월 단위로 조회합니다.</p></div>
        <div className="period-tabs">{(["일", "주", "월", "직접 선택"] as const).map((mode) => <button type="button" key={mode} className={periodMode === mode ? "active" : ""} onClick={() => setPeriodMode(mode)}>{mode}</button>)}</div>
        <div className="period-range"><small>{periodMode} 기준</small><strong>{periodMode === "월" ? "2026-06-01 ~ 2026-06-30" : periodMode === "주" ? "2026-06-23 ~ 2026-06-30" : "2026-06-30"}</strong><button type="button">기간 변경</button></div>
      </section>

      <section className="ops-kpis" data-tour="home-kpis">
        <div className="ops-kpi"><span className="kpi-icon blue">M</span><div><small>6월 마감 진행률</small><strong>94.8%</strong><p>5개 시스템 중 4개 마감</p></div><i>진행</i></div>
        <button className="ops-kpi actionable" type="button" onClick={() => openTrace("VV-20260703-9001", "mismatch")}><span className="kpi-icon red">!</span><div><small>미결 대사 예외</small><strong>4건</strong><p>우선 확인 2 · 정상 시차 1</p></div><i>확인</i></button>
        <div className="ops-kpi"><span className="kpi-icon amber">W</span><div><small>내 처리 사건</small><strong>3건</strong><p>담당자 답변 대기 1건</p></div><i>진행</i></div>
        <div className="ops-kpi"><span className="kpi-icon navy">₩</span><div><small>미확정 영향 금액</small><strong>10,000,000원</strong><p>6월 카드매출 기준</p></div><i>집계</i></div>
      </section>

      <section className="content-card reconciliation-card">
        <div className="section-title"><div><span className="section-kicker">PERIOD RECONCILIATION</span><h2>일자·카드사별 대사 결과</h2></div><div className="section-actions"><span>차이가 있는 행을 선택하면 흐름을 추적합니다.</span><button className="text-button" type="button" onClick={() => downloadCsv("6월_카드매출_대사결과.csv", ["일자", "카드사", "POS", "VAN", "카드사 매입", "정산", "ERP", "차이", "상태"], reconciliationRows.map((row) => [row.date, row.card, row.pos, row.van, row.acquired, row.settled, row.erp, row.gap, row.status]))}>엑셀용 CSV ↓</button></div></div>
        <div className="table-scroll"><table><thead><tr><th>영업일</th><th>카드사</th><th>POS 매출</th><th>VAN 승인</th><th>카드사 매입</th><th>정산액</th><th>ERP 반영</th><th>차이</th><th>판정</th></tr></thead>
          <tbody>{reconciliationRows.map((row) => <tr key={row.date} className={row.gap > 0 ? "exception-row" : ""} onClick={() => row.gap > 0 && openTrace("VV-20260703-9001", "mismatch")}>
            <td className="mono strong">{row.date}</td><td>{row.card}</td><td>{formatWon(row.pos)}</td><td>{formatWon(row.van)}</td><td>{formatWon(row.acquired)}</td><td>{formatWon(row.settled)}</td><td>{formatWon(row.erp)}</td><td className={row.gap > 0 ? "danger-text strong" : ""}>{formatWon(row.gap)}</td><td><span className={"record-status " + (row.gap > 0 ? "error" : row.status === "정상 시차" ? "waiting" : "resolved")}>{row.status}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className={"incident-hero " + scenario.tone}>
        <div className="incident-icon">!</div><div className="incident-copy"><small>INC-2026-0703-003 · 자동 감지</small><h2>{scenario.eventTitle}</h2><p>{scenario.eventSummary}</p></div>
        <div className="incident-metrics"><div><small>영향 거래</small><strong>{scenario.impactCount}건</strong></div><div><small>영향 금액</small><strong>{formatWon(scenario.impactAmount)}</strong></div><div><small>분류</small><strong>{scenario.classification}</strong></div></div>
        <button type="button" className="white-button" onClick={() => openTrace("VV-20260703-9001", "mismatch")}>전체 흐름 추적 →</button>
      </section>

      <section className="content-card flow-card" data-tour="flow-divergence">
        <div className="section-title"><div><span className="section-kicker">END-TO-END FLOW</span><h2>6월 선택 범위 처리 상태</h2></div><div className="legend"><span className="normal">정상</span><span className="waiting">대기</span><span className="review">확인 필요</span><span className="error">오류</span></div></div>
        <FlowStrip stages={scenario.flow} />
        <div className="divergence-banner"><span>최초 이상 구간</span><strong>{scenario.divergence}</strong><p>이전 단계까지는 건수·금액·연결 키가 일치합니다.</p></div>
      </section>

      <div className="dashboard-bottom">
        <section className="content-card table-card">
          <div className="section-title"><div><span className="section-kicker">AFFECTED TRANSACTIONS</span><h2>영향 거래</h2></div><button className="text-button" type="button" onClick={() => downloadTransactions(scenario)}>엑셀용 CSV ↓</button></div>
          <TransactionTable scenario={scenario} />
        </section>
        <aside className="content-card pattern-card">
          <span className="section-kicker">PATTERN SUMMARY</span><h2>영향 거래의 공통점</h2><p>단순 합계 대신 일자·승인번호·배치 속성을 묶어 조사 범위를 좁혔습니다.</p>
          <div className="trait-list">{scenario.commonTraits.map((trait, index) => <div key={trait}><span>{index + 1}</span><strong>{trait}</strong></div>)}</div>
          <button className="secondary-button full" type="button" onClick={() => openTrace("VV-20260703-9001", "mismatch")}>통합 거래 추적 보기</button>
        </aside>
      </div>
    </div>
  );
}

function TransactionTable({ scenario }: { scenario: Scenario }) {
  return (
    <div className="table-scroll transaction-table"><table><thead><tr><th>POS 거래번호</th><th>점포</th><th>카드사</th><th>POS 영업일</th><th>승인일자</th><th>승인시각</th><th>승인번호</th><th>매입일자</th><th>정산일자</th><th>회계일자</th><th>금액</th><th>상태</th></tr></thead>
      <tbody>{scenario.incidents.map((row) => {
        const waiting = row.state.includes("대기") || row.state.includes("재시도");
        return <tr key={row.transactionId}><td className="mono strong">{row.transactionId}</td><td>{row.store}</td><td>{row.cardCompany}</td><td>{row.businessDate ?? "2026-06-30"}</td><td>{row.approvalDate ?? "2026-06-30"}</td><td className="mono">{row.approvedAt}</td><td className="mono">{row.approvalNo ?? ("30" + row.transactionId.slice(-5))}</td><td>{row.acquisitionDate ?? (waiting ? "미반영" : "2026-07-01")}</td><td>{row.settlementDate ?? (waiting ? "미반영" : "2026-07-02")}</td><td>{row.accountingDate ?? "2026-06-30"}</td><td>{formatWon(row.amount)}</td><td><span className={"table-status " + scenario.tone}>{row.state}</span></td></tr>;
      })}</tbody>
    </table></div>
  );
}

function Investigation({ scenario }: { scenario: Scenario }) {
  const setView = useSettlementStore((state) => state.setView);
  const analyzing = useSettlementStore((state) => state.analyzing);
  const analyzed = useSettlementStore((state) => state.analyzed);
  const selectedHypothesis = useSettlementStore((state) => state.selectedHypothesis);
  const startAnalysis = useSettlementStore((state) => state.startAnalysis);
  const finishAnalysis = useSettlementStore((state) => state.finishAnalysis);
  const selectHypothesis = useSettlementStore((state) => state.selectHypothesis);

  const runAnalysis = () => { startAnalysis(); window.setTimeout(finishAnalysis, 900); };
  const hypothesis = scenario.hypotheses[selectedHypothesis];
  return (
    <div className="page-stack">
      <PageHeading eyebrow="AI INVESTIGATION WORKBENCH" title="원인 후보와 조사 순서를 비교합니다" description="AI는 원인을 확정하지 않고, 확인 가능한 단서와 부족한 정보를 함께 제시합니다."
        actions={<button type="button" className="secondary-button" onClick={() => setView("dashboard")}>← 통합 현황</button>} />
      <section className="content-card trace-card">
        <div className="section-title"><div><span className="section-kicker">FIRST DIVERGENCE</span><h2>{scenario.divergence}</h2></div><span className={`status-pill ${scenario.tone}`}>{scenario.classification}</span></div>
        <FlowStrip stages={scenario.flow} compact />
      </section>
      {!analyzed ? (
        <section className="analysis-empty">
          {analyzing ? <><div className="analysis-loader"><span/><span/><span/></div><h2>관련 단서를 교차 분석하고 있습니다</h2><p>거래시간, 배치 로그, 마스터 변경, 과거 유사 사례를 비교합니다.</p><div className="analysis-steps"><span className="done">거래 흐름 연결</span><span className="active">원인 후보 비교</span><span>담당자 추천</span></div></>
          : <><div className="analysis-mark">AI</div><h2>불일치 숫자만으로는 원인을 확정할 수 없습니다</h2><p>주변 이력을 함께 비교해 먼저 확인할 가설과 담당자를 추천합니다.</p><div className="source-chips"><span>거래 100건</span><span>배치 로그 4개</span><span>마스터 변경 2개</span><span>유사 사례 8건</span></div><button type="button" className="primary-button" onClick={runAnalysis}>AI 조사 시작하기 <span>→</span></button></>}
        </section>
      ) : (
        <div className="analysis-layout" data-tour="ai-investigation">
          <section className="hypothesis-panel content-card">
            <div className="section-title"><div><span className="section-kicker">RANKED HYPOTHESES</span><h2>원인 후보</h2></div><small>근거 일치도 기준</small></div>
            <div className="hypothesis-list">{scenario.hypotheses.map((item, index) => (
              <button type="button" key={item.title} className={`hypothesis-card ${selectedHypothesis === index ? "selected" : ""}`} onClick={() => selectHypothesis(index)}>
                <span className="rank">{index + 1}</span><div><small>조사 우선순위 {index + 1}</small><h3>{item.title}</h3><p>{item.summary}</p><div className="confidence-row"><span>근거 일치도 {item.confidence}</span><div><i style={{ width: `${item.score}%` }} /></div><strong>{item.score}</strong></div></div>
              </button>
            ))}</div>
          </section>
          <section className="evidence-panel content-card">
            <div className="evidence-head"><div><small>선택한 가설</small><h2>{hypothesis.title}</h2></div><span className={`confidence-badge ${hypothesis.confidence === "높음" ? "high" : hypothesis.confidence === "중간" ? "medium" : "low"}`}>일치도 {hypothesis.confidence}</span></div>
            <p className="evidence-summary">{hypothesis.summary}</p>
            <EvidenceList title="판단 근거" tone="positive" items={hypothesis.evidence} />
            <EvidenceList title="반대 근거·불확실성" tone="negative" items={hypothesis.counterEvidence} />
            <EvidenceList title="다음 확인 항목" tone="next" items={hypothesis.nextChecks} />
            <div className="owner-recommendation"><span className="owner-avatar">{scenario.recommendedOwner.slice(0, 1)}</span><div><small>우선 확인 추천</small><strong>{scenario.recommendedTeam}</strong><p>{scenario.recommendedOwner} 담당자</p></div><button className="primary-button small" type="button" onClick={() => setView("resolution")}>업무 요청 준비 →</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function EvidenceList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return <div className={`evidence-block ${tone}`}><h3>{title}</h3><ul>{items.map((item) => <li key={item}><span>{tone === "positive" ? "✓" : tone === "negative" ? "!" : "→"}</span>{item}</li>)}</ul></div>;
}

function Resolution({ scenario }: { scenario: Scenario }) {
  const setView = useSettlementStore((state) => state.setView);
  const assignedOwner = useSettlementStore((state) => state.assignedOwner);
  const requestGenerated = useSettlementStore((state) => state.requestGenerated);
  const reprocessing = useSettlementStore((state) => state.reprocessing);
  const resolved = useSettlementStore((state) => state.resolved);
  const analyzed = useSettlementStore((state) => state.analyzed);
  const assignOwner = useSettlementStore((state) => state.assignOwner);
  const generateRequest = useSettlementStore((state) => state.generateRequest);
  const startReprocess = useSettlementStore((state) => state.startReprocess);
  const finishReprocess = useSettlementStore((state) => state.finishReprocess);
  const [copied, setCopied] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replies, setReplies] = useState<string[]>([]);
  const runReconciliation = () => { startReprocess(); window.setTimeout(finishReprocess, 1000); };
  const copyMessage = async () => { await navigator.clipboard?.writeText(scenario.requestMessage); setCopied(true); window.setTimeout(() => setCopied(false), 1200); };
  const addReply = () => { if (!replyText.trim()) return; setReplies((items) => [...items, replyText.trim()]); setReplyText(""); };

  if (!analyzed) return <div className="page-stack"><PageHeading eyebrow="CASE WORKFLOW" title="먼저 AI 조사를 실행해 주세요" description="조사 결과가 만들어지면 담당자 요청과 확인 흐름을 이어갈 수 있습니다."/><section className="analysis-empty"><div className="analysis-mark">04</div><h2>AI 조사 결과가 아직 없습니다</h2><p>원인 후보와 담당자를 확인한 후 사건 처리를 시작합니다.</p><button className="primary-button" type="button" onClick={() => setView("investigation")}>AI 조사 화면으로 이동 →</button></section></div>;

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CASE WORKFLOW" title="담당자 문의와 처리 근거를 한 사건에 기록합니다" description="외부 메신저에는 알림과 링크를 보내고, 확인 내용과 조치 결과는 사건 화면에 남기는 데모입니다." />
      {resolved && <section className="resolved-banner"><div className="resolved-check">✓</div><div><small>INC-2026-0703-003</small><h2>최신 데이터를 다시 대사해 정상화를 확인했습니다</h2><p>확정 원인과 조치 결과가 유사 사례 지식으로 저장됐습니다.</p></div><span>해결 완료</span></section>}

      <div className="resolution-layout" data-tour="case-resolution">
        <section className="content-card action-panel">
          <div className="section-title"><div><span className="section-kicker">ASSIGN & REQUEST</span><h2>담당자 확인 요청</h2></div><span className={"status-pill " + (resolved ? "blue" : scenario.tone)}>{resolved ? "처리 완료" : "담당자 배정"}</span></div>
          <div className="owner-box"><span className="owner-avatar large">{scenario.recommendedOwner.slice(0, 1)}</span><div><small>AI 추천 담당 영역</small><h3>{scenario.recommendedTeam}</h3><p>{scenario.recommendedOwner} 담당자</p></div><button type="button" className={assignedOwner ? "assigned-button" : "secondary-button"} onClick={() => assignOwner(scenario.recommendedOwner)}>{assignedOwner ? "✓ 배정 완료" : "담당자 배정"}</button></div>
          <div className="field-group"><label htmlFor="request-message">AI 추천 문의문</label><textarea id="request-message" readOnly value={requestGenerated ? scenario.requestMessage : "AI 분석 근거와 확인 항목을 포함한 문의문을 생성할 수 있습니다."} /></div>
          <div className="button-row"><button className="primary-button" type="button" onClick={generateRequest}>문의문 생성</button><button className="secondary-button" type="button" disabled={!requestGenerated} onClick={copyMessage}>{copied ? "복사 완료" : "내용 복사"}</button><button className="secondary-button" type="button" disabled={!requestGenerated || !assignedOwner} onClick={() => setMessageSent(true)}>{messageSent ? "✓ Teams 알림 전송됨" : "Teams로 알림 보내기"}</button></div>
          <div className="audit-note"><span>연동 원칙</span> 메신저는 알림 채널로 사용하고, 사건번호·근거·답변·첨부 이력은 이 시스템에 보존합니다.</div>
        </section>

        <section className="content-card conversation-panel">
          <div className="section-title"><div><span className="section-kicker">CASE CONVERSATION</span><h2>사건 대화</h2></div><small>{messageSent ? "담당자 알림 완료" : "알림 전송 전"}</small></div>
          <div className="message-list">
            <div className="message-bubble system"><small>07-03 09:44 · 회계 담당자</small><strong>확인 요청</strong><p>{requestGenerated ? scenario.requestMessage : "문의문을 생성하면 이곳에 사건 메시지로 기록됩니다."}</p></div>
            {messageSent && <div className="message-bubble owner"><small>07-03 10:02 · {scenario.recommendedOwner}</small><strong>담당자 답변</strong><p>해당 배치와 원천 로그를 확인하겠습니다. 처리 결과와 대상 거래번호를 이 사건에 남기겠습니다.</p></div>}
            {replies.map((reply, index) => <div className="message-bubble system" key={index}><small>추가 메모 · 회계 담당자</small><p>{reply}</p></div>)}
          </div>
          <div className="case-composer"><textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="확인 내용이나 추가 질문을 기록하세요."/><button type="button" className="primary-button small" onClick={addReply}>기록</button></div>
        </section>
      </div>

      <section className="content-card reprocess-panel">
        <div className="section-title"><div><span className="section-kicker">REFRESH & RECONCILE</span><h2>최신 데이터 재수집·재대사</h2></div><small>{resolved ? "07-03 10:18 완료" : "담당자 조치 후 실행"}</small></div>
        <div className="before-after"><div className="flow-compare before"><span>조치 전</span><strong>{scenario.flow[2].count}건</strong><small>{scenario.divergence}</small></div><div className={"compare-arrow " + (reprocessing ? "spinning" : "")}>{reprocessing ? "↻" : "→"}</div><div className={"flow-compare after " + (resolved ? "complete" : "")}><span>최신 수집 후</span><strong>{resolved ? "100건" : "—"}</strong><small>{resolved ? "5단계 일치" : "재대사 대기"}</small></div></div>
        <div className="verification-list">{["담당자 조치 내용 기록", "최신 원천 데이터 수집", "건수·금액·연결 키 재대사", "회계 담당자 종료 승인"].map((item) => <div key={item} className={resolved ? "complete" : ""}><span>{resolved ? "✓" : "○"}</span><strong>{item}</strong><small>{resolved ? "완료" : "대기"}</small></div>)}</div>
        <button type="button" className="primary-button full" disabled={reprocessing || resolved || !assignedOwner || !requestGenerated || !messageSent} onClick={runReconciliation}>{reprocessing ? "최신 데이터를 수집해 재대사하는 중..." : resolved ? "정상화 확인 완료" : "최신 데이터 재수집 및 재대사"}</button>
        {!messageSent && <p className="helper-text">담당자를 배정하고 문의 알림을 보낸 뒤 조치 결과를 확인해 주세요.</p>}
      </section>

      <section className="content-card history-card">
        <div className="section-title"><div><span className="section-kicker">AUDIT TRAIL</span><h2>처리 이력</h2></div><button className="text-button" type="button">전체 이력 보기</button></div>
        <div className="history-line">
          <HistoryItem time="09:42" title="대사 예외 자동 감지" detail={scenario.divergence + " · " + scenario.impactCount + "건"} state="done" />
          <HistoryItem time="09:44" title="AI 조사 완료" detail={"1순위: " + scenario.hypotheses[0].title} state="done" />
          <HistoryItem time={assignedOwner ? "09:46" : "—"} title="담당자 확인 요청" detail={assignedOwner ? scenario.recommendedTeam + " · " + assignedOwner : "대기 중"} state={assignedOwner ? "done" : "pending"} />
          <HistoryItem time={resolved ? "10:18" : "—"} title="재수집 및 재대사" detail={resolved ? "5단계 정상 연결" : "대기 중"} state={resolved ? "done" : "pending"} />
        </div>
      </section>
    </div>
  );
}

function HistoryItem({ time, title, detail, state }: { time: string; title: string; detail: string; state: string }) {
  return <div className={`history-item ${state}`}><span className="history-dot">{state === "done" ? "✓" : ""}</span><small>{time}</small><strong>{title}</strong><p>{detail}</p></div>;
}





function SystemDataPage({ scenario }: { scenario: Scenario }) {
  const systemTab = useSettlementStore((state) => state.systemTab);
  const setSystemTab = useSettlementStore((state) => state.setSystemTab);
  const openTrace = useSettlementStore((state) => state.openTrace);
  const [query, setQuery] = useState("");
  const datasets = buildSystemDatasets(scenario);
  const active = datasets.find((item) => item.key === systemTab) ?? datasets[0];
  const rows = active.rows.filter((row) => row.values.join(" ").toLowerCase().includes(query.toLowerCase()));
  const previous = datasets[Math.max(0, datasets.findIndex((item) => item.key === systemTab) - 1)];

  return (
    <div className="page-stack">
      <PageHeading eyebrow="SOURCE DATA" title="원천 데이터 조회" description="거래번호, 승인번호, 매입번호, 정산번호와 전표번호로 5개 시스템 데이터를 조회합니다."
        actions={<button className="secondary-button" type="button">조회 조건 저장</button>} />
      <section className="system-summary-strip">
        {datasets.map((item) => <button key={item.key} type="button" className={`system-summary ${systemTab === item.key ? "active" : ""} ${item.gap > 0 ? "has-gap" : ""}`} onClick={() => setSystemTab(item.key)}>
          <span>{item.label}</span><strong>{item.totalCount.toLocaleString()}건</strong><small>{item.gapLabel}</small>
        </button>)}
      </section>
      <section className="content-card source-data-card">
        <div className="source-data-head">
          <div><span className="section-kicker">{active.english.toUpperCase()}</span><h2>{active.label} 데이터 조회</h2><p>{active.description}</p></div>
          <div className="source-health"><small>최근 수집</small><strong>{active.receivedAt}</strong><span className={active.gap > 0 ? "warning" : "healthy"}>{active.gap > 0 ? active.gapLabel : "수집 정상"}</span></div>
        </div>
        <div className="data-toolbar">
          <div className="filter-group"><label>대상 기간</label><button type="button">2026-06-01 ~ 06-30</button></div>
          <div className="filter-group"><label>점포</label><button type="button">전체 점포</button></div>
          <div className="data-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${active.label} 번호·연결번호 검색`} aria-label="시스템 데이터 검색" /></div>
          <button className="secondary-button" type="button">필터</button>
        </div>
        <div className="dataset-context">
          <div><small>{systemTab === "erp" ? "전표 헤더" : "처리 건수"}</small><strong>{active.totalCount.toLocaleString()}건</strong></div>
          <div><small>{systemTab === "erp" ? "선택 전표 정산액" : "총 금액"}</small><strong>{formatWon(active.totalAmount)}</strong></div>
          <div><small>{systemTab === "erp" ? "집계 원천" : "이전 단계"}</small><strong>{systemTab === "pos" ? "판매 원천" : previous.label}</strong></div>
          <div><small>{systemTab === "erp" ? "원천 연결 검증" : "연결 상태"}</small><strong className={active.gap > 0 ? "danger-text" : "success-text"}>{active.gapLabel}</strong></div>
        </div>
        <GenericDataTable columns={active.columns} rows={rows} onOpen={(ref) => openTrace(ref, "system")} />
      </section>

    </div>
  );
}

function GenericDataTable({ columns, rows, onOpen }: { columns: string[]; rows: ReturnType<typeof buildSystemDatasets>[number]["rows"]; onOpen: (ref: string) => void }) {
  return <div className="table-scroll source-table"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}<th>연결 추적</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}>{row.values.map((value, index) => <td key={`${row.id}-${index}`} className={index === 0 ? "mono strong" : ""}>{value}</td>)}<td><button className="row-link" type="button" onClick={() => onOpen(row.traceRef)}>전체 흐름 →</button></td></tr>)}</tbody>
  </table>{rows.length === 0 && <div className="empty-table">검색 조건에 맞는 데이터가 없습니다.</div>}</div>;
}

function ErpVournalPage({ scenario }: { scenario: Scenario }) {
  const openTrace = useSettlementStore((state) => state.openTrace);
  const erp = buildSystemDatasets(scenario).find((item) => item.key === "erp")!;
  const selectedVournal = erp.rows[0];
  const [selectedDate, setSelectedDate] = useState("06-30");
  const cardStage = scenario.flow.find((stage) => stage.id === "card") ?? scenario.flow[2];
  const settlementStage = scenario.flow.find((stage) => stage.id === "settlement") ?? scenario.flow[3];
  const erpStage = scenario.flow.find((stage) => stage.id === "erp") ?? scenario.flow[4];
  const sourceCount = settlementStage.count;
  const journalNeedsReview = erpStage.status === "error";
  const expectedGross = cardStage.amount;
  const expectedNet = settlementStage.amount;
  const expectedFee = Math.max(0, expectedGross - expectedNet);
  const dayRows = [
    { date: "06-28", sales: 82, gross: 82_400_000, acquired: 82_400_000, settled: 81_000_000, linked: 82, gap: 0, status: "정상" },
    { date: "06-29", sales: 94, gross: 94_600_000, acquired: 94_600_000, settled: 92_992_000, linked: 94, gap: 0, status: "정상" },
    { date: "06-30", sales: 100, gross: 100_000_000, acquired: cardStage.amount, settled: settlementStage.amount, linked: sourceCount, gap: scenario.impactAmount, status: scenario.classification },
    { date: "07-01 이월", sales: 5, gross: 5_000_000, acquired: scenario.id === "normal-delay" ? 5_000_000 : 0, settled: 0, linked: 0, gap: scenario.id === "normal-delay" ? 0 : 5_000_000, status: scenario.id === "normal-delay" ? "정상 시차" : "확인 필요" },
  ];
  const journalLines = [
    { no: 1, side: "차변", account: "카드정산미수금", amount: expectedNet, memo: "6월 카드 정산 예정액" },
    { no: 2, side: "차변", account: "지급수수료", amount: expectedFee, memo: "카드사 수수료" },
    { no: 3, side: "대변", account: "카드매출미수금", amount: expectedGross, memo: "6월 매입 확정 카드매출" },
  ];

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ERP VOURNAL CONTROL" title="ERP 전표와 포함 매출 검증" description="일·주·월 집계 전표를 선택하고 그 안에 묶인 영업일과 원천 거래를 확인합니다."
        actions={<><button className="secondary-button" type="button">집계 규칙 조회</button><button className="primary-button small" type="button" onClick={() => downloadTransactions(scenario)}>포함 매출 CSV ↓</button></>} />

      <section className="journal-kpis">
        <div className="content-card"><small>선택 전표 헤더</small><strong>1건</strong><span>{String(selectedVournal.values[0])}</span></div>
        <div className="content-card"><small>전표 집계 주기</small><strong>월마감</strong><span>2026-06-01 ~ 06-30</span></div>
        <div className="content-card"><small>연결 정산 원천</small><strong>{sourceCount}건</strong><span>일자별로 드릴다운 가능</span></div>
        <div className={"content-card " + (journalNeedsReview ? "alert" : "")}><small>전표 검증 결과</small><strong>{journalNeedsReview ? "전표 구성 확인" : "전표 자체 정상"}</strong><span>{journalNeedsReview ? "연결 원천 불일치" : "상위 단계 차이는 별도 사건"}</span></div>
      </section>

      <section className={"journal-focus " + (journalNeedsReview ? "red" : "blue")}>
        <div><span className="section-kicker">SELECTED VOURNAL</span><h2>{String(selectedVournal.values[0])} · 강남점 신한카드 월마감</h2><p>대상기간 2026-06-01 ~ 2026-06-30 · 회계일 2026-07-03 · 집계규칙: 기간+점포+카드사</p></div>
        <div className="reverse-route"><span>ERP 전표 1건</span><i>←</i><span>일자 30개</span><i>←</i><span>정산 원천 {sourceCount}건</span></div>
        <button className="white-button" type="button" onClick={() => openTrace(String(selectedVournal.values[0]), "erp")}>5단계 흐름 보기 →</button>
      </section>

      <section className="content-card journal-breakdown" data-tour="journal-validation">
        <div className="section-title"><div><span className="section-kicker">DAILY BREAKDOWN</span><h2>전표에 포함된 일자별 매출</h2><p>한 달 전표라도 이상 일자를 먼저 찾은 뒤 해당 거래까지 내려갑니다.</p></div><span className="status-pill blue">선택 {selectedDate}</span></div>
        <div className="table-scroll"><table><thead><tr><th>영업일</th><th>POS 매출 건수</th><th>POS 매출액</th><th>카드사 매입액</th><th>정산액</th><th>ERP 연결 원천</th><th>차이</th><th>판정</th></tr></thead>
          <tbody>{dayRows.map((row) => <tr key={row.date} className={(selectedDate === row.date ? "selected-row " : "") + (row.gap > 0 ? "exception-row" : "")} onClick={() => setSelectedDate(row.date)}>
            <td className="mono strong">{row.date}</td><td>{row.sales}건</td><td>{formatWon(row.gross)}</td><td>{formatWon(row.acquired)}</td><td>{formatWon(row.settled)}</td><td>{row.linked}건</td><td className={row.gap > 0 ? "danger-text strong" : ""}>{formatWon(row.gap)}</td><td><span className={"record-status " + (row.gap > 0 ? "error" : row.status === "정상 시차" ? "waiting" : "resolved")}>{row.status}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="content-card included-sales-card">
        <div className="section-title"><div><span className="section-kicker">INCLUDED SALES</span><h2>{selectedDate} 전표 포함 매출</h2><p>승인일자와 승인번호를 별도 열로 확인하고 엑셀에서도 그대로 분석할 수 있습니다.</p></div><button className="text-button" type="button" onClick={() => downloadTransactions(scenario)}>현재 거래 CSV ↓</button></div>
        <TransactionTable scenario={scenario} />
      </section>

      <div className="journal-validation-layout">
        <section className="content-card journal-validation-card">
          <div className="section-title"><div><span className="section-kicker">EXPECTED VS ACTUAL</span><h2>예상 전표 대 실제 전표</h2></div><span className={"record-status " + (journalNeedsReview ? "error" : "resolved")}>{journalNeedsReview ? "구성 확인" : "금액 일치"}</span></div>
          <div className="validation-list">
            <div className="validation-row validation-head"><span>검증 항목</span><span>산출 기준</span><span>예상값</span><span>실제값</span><span>결과</span></div>
            {[
              ["총매출", "카드사 매입 확정액", formatWon(expectedGross), formatWon(expectedGross), true],
              ["카드 수수료", "정산 수수료 합계", formatWon(expectedFee), formatWon(expectedFee), true],
              ["정산 예정액", "정산시스템 집계", formatWon(expectedNet), formatWon(expectedNet), true],
              ["원천 거래 연결", "정산 대상 고유 거래", sourceCount + "건", sourceCount + "건", !journalNeedsReview],
              ["집계 기간", "회사 월마감 규칙", "06-01 ~ 06-30", "06-01 ~ 06-30", true],
            ].map((row) => <div className={"validation-row " + (row[4] ? "" : "failed")} key={String(row[0])}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span>{row[3]}</span><i>{row[4] ? "일치" : "확인"}</i></div>)}
          </div>
        </section>
        <aside className="content-card source-link-card">
          <div className="section-title"><div><span className="section-kicker">ACCOUNTING RULE</span><h2>이 전표의 집계 기준</h2></div></div>
          <div className="coverage-number"><strong>월 1건</strong><span>매출마다 전표 1건이 아닙니다</span></div>
          <div className="aggregation-rule"><small>전표 집계 키</small><div><span>대상 기간</span><span>점포</span><span>카드사</span><span>결제수단</span></div></div>
          <div className={"journal-diagnosis " + (journalNeedsReview ? "error" : "normal")}><strong>{journalNeedsReview ? "ERP 구성 확인 필요" : "ERP 전표 자체는 정상"}</strong><p>{journalNeedsReview ? "전표 금액과 별개로 연결된 원천 거래 구성을 확인합니다." : "현재 사건의 최초 이상은 " + scenario.divergence + " 구간입니다. ERP 건수와 이전 단계 건수를 1:1로 비교하지 않습니다."}</p></div>
        </aside>
      </div>

      <section className="content-card journal-lines-card">
        <div className="section-title"><div><span className="section-kicker">VOURNAL LINES</span><h2>데모 분개 라인</h2></div><small>실제 계정과목과 생성 방식은 회사 정책에 따라 달라집니다.</small></div>
        <div className="table-scroll"><table><thead><tr><th>라인</th><th>차/대변</th><th>계정과목</th><th>금액</th><th>적요</th><th>검증</th></tr></thead><tbody>{journalLines.map((line) => <tr key={line.no}><td>{line.no}</td><td><span className={"entry-side " + (line.side === "차변" ? "debit" : "credit")}>{line.side}</span></td><td className="strong">{line.account}</td><td>{formatWon(line.amount)}</td><td>{line.memo}</td><td><span className="record-status resolved">금액 일치</span></td></tr>)}</tbody></table></div>
      </section>

      <section className="content-card journal-table-card">
        <div className="section-title"><div><span className="section-kicker">VOURNAL LIST</span><h2>전표 목록</h2></div><div className="journal-filters"><button type="button">전체 점포</button><button type="button">일·주·월 전체</button><button type="button">대상기간 2026-06</button></div></div>
        <GenericDataTable columns={erp.columns} rows={erp.rows} onOpen={(ref) => openTrace(ref, "erp")} />
      </section>
    </div>
  );
}

function MismatchPage({ scenario }: { scenario: Scenario }) {
  const openTrace = useSettlementStore((state) => state.openTrace);
  const records = buildMismatchRecords(scenario);
  return (
    <div className="page-stack">
      <PageHeading eyebrow="UNMATCHED & EXCEPTIONS" title="전표가 없거나 연결되지 않은 건도 찾습니다" description="ERP 전표가 아직 없는 사건도 POS·VAN·카드사·정산 데이터에서 정방향으로 추적합니다." />
      <section className="exception-stats">
        <div><span className="red">!</span><small>확인 필요</small><strong>2건</strong></div><div><span className="amber">◷</span><small>정상 지연</small><strong>1건</strong></div><div><span className="blue">↻</span><small>처리 중</small><strong>1건</strong></div><div><span className="navy">Σ</span><small>영향 금액</small><strong>{formatWon(records.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
      </section>
      <section className="content-card mismatch-card" data-tour="exception-inbox">
        <div className="data-toolbar mismatch-toolbar"><div className="filter-group"><label>기간</label><button type="button">2026-06-01 ~ 06-30</button></div><div className="filter-group"><label>유형</label><button type="button">전체 예외</button></div><div className="filter-group"><label>처리 상태</label><button type="button">전체 상태</button></div><div className="data-search"><span>⌕</span><input placeholder="사건번호·거래번호 검색" aria-label="불일치 검색" /></div></div>
        <div className="mismatch-list">
          {records.map((record, index) => <button key={record.id} type="button" className={`mismatch-row ${index === 0 ? "featured" : ""}`} onClick={() => openTrace(record.traceRef, "mismatch")}>
            <div className="mismatch-severity"><span>{record.status === "정상 지연" ? "대기" : record.status === "처리 중" ? "진행" : "확인"}</span></div>
            <div className="mismatch-main"><small>{record.id} · {record.detectedAt}</small><h3>{record.title}</h3><p>{record.source} → {record.target}</p></div>
            <div><small>영향 거래</small><strong>{record.count}건</strong></div><div><small>영향 금액</small><strong>{formatWon(record.amount)}</strong></div><div><small>최초 이상 구간</small><strong>{record.firstGap}</strong></div><span className={`record-status ${record.status === "정상 지연" ? "waiting" : record.status === "처리 중" ? "progress" : "error"}`}>{record.status}</span><i>→</i>
          </button>)}
        </div>
      </section>
    </div>
  );
}

function TracePage({ scenario }: { scenario: Scenario }) {
  const setView = useSettlementStore((state) => state.setView);
  const selectedReference = useSettlementStore((state) => state.selectedReference);
  const traceSource = useSettlementStore((state) => state.traceSource);

  const traceRows = buildTraceRows(scenario);
  const sourceLabel = traceSource === "erp" ? "ERP 전표에서 역추적" : traceSource === "mismatch" ? "미연결 사건에서 정방향 추적" : "시스템 원천 데이터에서 추적";
  return (
    <div className="page-stack">
      <PageHeading eyebrow="END-TO-END TRANSACTION TRACE" title="한 건의 연결 관계를 시스템 끝까지 확인합니다" description="각 시스템의 문서번호, 연결 키, 금액, 처리 시각을 한 흐름으로 비교합니다."
        actions={<button type="button" className="secondary-button" onClick={() => setView(traceSource === "erp" ? "erp" : traceSource === "mismatch" ? "mismatches" : "systemData")}>← 이전 목록</button>} />
      <section className="trace-origin content-card">
        <div><small>추적 기준</small><strong>{selectedReference}</strong><span>{sourceLabel}</span></div>
        <div><small>점포</small><strong>강남점 · S00123</strong><span>카드 매출</span></div>
        <div><small>대상 기간</small><strong>2026-06-01 ~ 06-30</strong><span>회계일자 2026-07-03</span></div>
        <div><small>연결 결과</small><strong className="danger-text">{scenario.classification}</strong><span>영향 {scenario.impactCount}건</span></div>
      </section>
      <section className="content-card full-trace-card" data-tour="transaction-trace">
        <div className="section-title"><div><span className="section-kicker">LINKED DOCUMENT FLOW</span><h2>문서 연결 흐름</h2></div><span className={`status-pill ${scenario.tone}`}>최초 이상 · {scenario.divergence}</span></div>
        <FlowStrip stages={scenario.flow} />
      </section>
      <div className="trace-detail-layout">
        <section className="content-card linkage-table-card">
          <div className="section-title"><div><span className="section-kicker">CORRELATION KEYS</span><h2>단계별 문서와 연결 키</h2></div><small>키가 바뀌어도 연결 관계를 함께 보존</small></div>
          <div className="table-scroll"><table><thead><tr><th>시스템</th><th>문서·레코드</th><th>다음 단계 연결 키</th><th>금액</th><th>처리 시각</th><th>상태</th></tr></thead><tbody>
            {traceRows.map((row) => <tr key={row.system}><td className="strong">{row.system}</td><td className="mono">{row.documentId}</td><td className="mono key-cell">{row.linkKey}</td><td>{formatWon(row.amount)}</td><td>{row.timestamp}</td><td><span className={`stage-status ${row.status}`}>{statusLabel[row.status]}</span></td></tr>)}
          </tbody></table></div>
        </section>
        <aside className="content-card trace-decision-card">
          <span className="section-kicker">INVESTIGATION GATE</span><h2>데이터 연결만으로 원인을 확정할 수 있나요?</h2>
          <div className="decision-check done"><span>✓</span><div><strong>최초 이상 구간 확인</strong><p>{scenario.divergence}</p></div></div>
          <div className="decision-check done"><span>✓</span><div><strong>영향 범위 특정</strong><p>{scenario.impactCount}건 · {formatWon(scenario.impactAmount)}</p></div></div>
          <div className="decision-check unresolved"><span>?</span><div><strong>원인 확정 불가</strong><p>정상 시차, 배치 오류, 마스터 조건을 추가 비교해야 합니다.</p></div></div>
          <button className="primary-button full" type="button" onClick={() => setView("investigation")}>AI 원인 조사 실행 →</button>
          <small>명확한 오류 코드가 있다면 AI 없이 담당자 처리로 바로 이동할 수 있습니다.</small>
        </aside>
      </div>
    </div>
  );
}

function FullHistoryPage({ scenario }: { scenario: Scenario }) {
  const resolved = useSettlementStore((state) => state.resolved);
  const openTrace = useSettlementStore((state) => state.openTrace);
  const cases = [
    ["CASE-2026-0716-003", scenario.hypotheses[0].title, scenario.recommendedTeam, resolved ? "해결 완료" : "처리 중", "07-16 11:42", scenario.impactCount],
    ["CASE-2026-0714-018", "점포 코드 마스터 반영 지연", "ERP 마스터 운영팀", "해결 완료", "07-14 16:10", 12],
    ["CASE-2026-0702-007", "월말 승인일과 카드사 매입일의 정상 시차", "정산 운영팀", "정상 종결", "07-02 10:05", 5],
    ["CASE-2026-0709-021", "취소 전문 재전송 실패", "VAN 인터페이스팀", "해결 완료", "07-09 14:28", 2],
  ];
  return (
    <div className="page-stack">
      <PageHeading eyebrow="CASE KNOWLEDGE & AUDIT" title="처리 이력과 확정 원인을 다음 조사에 활용합니다" description="누가 어떤 근거로 판단하고 무엇을 변경했는지 감사 가능한 형태로 보존합니다." />
      <section className="knowledge-kpis"><div><small>누적 사건</small><strong>128건</strong><span>최근 90일</span></div><div><small>평균 조사시간</small><strong>18분</strong><span>기존 74분 대비 감소</span></div><div><small>AI Top 3 포함</small><strong>87%</strong><span>확정 원인 기준</span></div><div><small>정상 지연 분류</small><strong>34건</strong><span>불필요 문의 방지</span></div></section>
      <section className="content-card case-history-card" data-tour="audit-history">
        <div className="section-title"><div><span className="section-kicker">RESOLVED CASES</span><h2>과거 사건과 유사 사례</h2></div><div className="journal-filters"><button type="button">전체 원인</button><button type="button">전체 담당팀</button><button type="button">최근 90일</button></div></div>
        <div className="table-scroll"><table><thead><tr><th>사건번호</th><th>확정 원인</th><th>처리 담당</th><th>상태</th><th>발생일시</th><th>영향 건수</th><th>상세</th></tr></thead><tbody>
          {cases.map((item) => <tr key={String(item[0])}><td className="mono strong">{item[0]}</td><td>{item[1]}</td><td>{item[2]}</td><td><span className={`record-status ${item[3] === "처리 중" ? "progress" : "resolved"}`}>{item[3]}</span></td><td>{item[4]}</td><td>{item[5]}건</td><td><button type="button" className="row-link" onClick={() => openTrace("VV-20260716-9001", "mismatch")}>흐름 보기 →</button></td></tr>)}
        </tbody></table></div>
      </section>
      <section className="content-card audit-log-card"><div className="section-title"><div><span className="section-kicker">AUDIT LOG</span><h2>현재 사건 변경 이력</h2></div><span className="status-pill blue">삭제 불가 기록</span></div>
        <div className="audit-timeline"><HistoryItem time="11:42" title="이상 징후 자동 감지" detail={`${scenario.divergence} · ${scenario.impactCount}건`} state="done"/><HistoryItem time="11:44" title="AI 조사 실행" detail={`원인 후보 ${scenario.hypotheses.length}개 생성`} state="done"/><HistoryItem time="11:45" title="담당자 배정" detail={`${scenario.recommendedTeam} · ${scenario.recommendedOwner}`} state="done"/><HistoryItem time={resolved ? "11:48" : "—"} title="재처리 결과" detail={resolved ? "100건 정상화 확인" : "처리 대기"} state={resolved ? "done" : "pending"}/></div>
      </section>
    </div>
  );
}
