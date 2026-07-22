"use client";

import { useEffect, useState } from "react";
import { DayPicker, type DateRange } from "@daypicker/react";
import { ko } from "@daypicker/react/locale";
import "@daypicker/react/style.css";
import { formatWon, getScenario, scenarios, type FlowStage, type Scenario, type StageStatus } from "./scenarios";
import { useSettlementStore, type AppView } from "./settlement-store";
import { buildMismatchRecords, buildSystemDatasets, buildTraceRows, type SystemKey } from "./system-data";

const navSections: Array<{ label: string; items: Array<{ id: AppView; label: string; icon: string; help: string }> }> = [
  { label: "오늘의 업무", items: [
    { id: "dashboard", label: "정산 업무 홈", icon: "⌂", help: "마감·예외·할 일" },
    { id: "mismatches", label: "대사 예외함", icon: "!", help: "조사할 사건 목록" },
  ] },
  { label: "조회 및 관리", items: [
    { id: "erp", label: "ERP 전표 조회", icon: "V", help: "전표·포함 매출 검증" },
    { id: "systemData", label: "원천 데이터 조회", icon: "D", help: "POS·VAN·카드·정산·ERP" },
    { id: "cardRules", label: "카드사 처리 기준", icon: "R", help: "매입·입금 예정 규칙" },
  ] },
  { label: "기록", items: [
    { id: "history", label: "처리 이력", icon: "H", help: "완료 사건·감사 기록" },
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

const formatCalendarDate = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");

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
  const guideActive = useSettlementStore((state) => state.guideActive);
  const guideStep = useSettlementStore((state) => state.guideStep);
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
              <button key={item.id} type="button" className={`nav-item ${view === item.id || (item.id === "mismatches" && (["case", "trace", "investigation", "resolution", "caseHistory"] as AppView[]).includes(view)) ? "active" : ""}`} onClick={() => setView(item.id)}>
                <span className="nav-number">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.help}</small></span>
              </button>
            ))}
          </div>)}
        </nav>
        <div className="sidebar-foot">
          <div className="demo-signal"><span /> 데이터 수집 정상</div>
          <p>POS·VAN·카드사·정산·ERP<br/>마지막 동기화 07-03 09:42</p>
          <button className="guide-start-button" type="button" onClick={() => setView("guide")}><span>?</span> 업무 가이드</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="topbar-path">정산 운영 <span>/</span> {navItems.find((item) => item.id === view)?.label ?? ((["case", "trace", "investigation", "resolution", "caseHistory"] as AppView[]).includes(view) ? "대사 예외 사건" : "업무 가이드")}</p>
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
          {view === "cardRules" && <CardCompanyRulesPage />}
          {view === "erp" && <ErpJournalPage scenario={scenario} />}
          {view === "mismatches" && <MismatchPage scenario={scenario} />}
          {view === "case" && <CaseOverview scenario={scenario} />}
          {view === "trace" && <TracePage scenario={scenario} />}
          {view === "investigation" && <Investigation scenario={scenario} />}
          {view === "resolution" && <Resolution scenario={scenario} />}
          {view === "caseHistory" && <CaseHistoryPage scenario={scenario} />}
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
  const setView = useSettlementStore((state) => state.setView);
  const openCase = useSettlementStore((state) => state.openCase);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const rangeLabel = dateRange?.from
    ? dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime()
      ? formatCalendarDate(dateRange.from) + " ~ " + formatCalendarDate(dateRange.to)
      : formatCalendarDate(dateRange.from)
    : "기간을 선택하세요";
  const selectDashboardPeriod = (mode: "일" | "주" | "월" | "직접 선택") => {
    setPeriodMode(mode);
    if (mode === "직접 선택") {
      setCalendarOpen(true);
      return;
    }
    setDateRange(mode === "월"
      ? { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) }
      : mode === "주"
        ? { from: new Date(2026, 5, 23), to: new Date(2026, 5, 30) }
        : { from: new Date(2026, 5, 30), to: new Date(2026, 5, 30) });
    setCalendarOpen(false);
  };
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
        <div className="period-tabs">{(["일", "주", "월", "직접 선택"] as const).map((mode) => <button type="button" key={mode} className={periodMode === mode ? "active" : ""} onClick={() => selectDashboardPeriod(mode)}>{mode}</button>)}</div>
        <div className="calendar-range-field dashboard-calendar"><span>{periodMode} 기준 조회 기간</span><button className="calendar-range-trigger" type="button" aria-expanded={calendarOpen} onClick={() => setCalendarOpen((open) => !open)}><i>▣</i><strong>{rangeLabel}</strong><em>{calendarOpen ? "닫기" : "달력 열기"}</em></button>
          {calendarOpen && <div className="calendar-popover dashboard-calendar-popover"><DayPicker animate mode="range" selected={dateRange} onSelect={(range) => { setDateRange(range); setPeriodMode("직접 선택"); }} defaultMonth={new Date(2026, 5, 1)} numberOfMonths={2} locale={ko} weekStartsOn={1} resetOnSelect /><div className="calendar-popover-footer"><div><small>선택한 대사 기간</small><strong>{rangeLabel}</strong></div><button type="button" disabled={!dateRange?.from || !dateRange?.to} onClick={() => setCalendarOpen(false)}>이 기간 적용</button></div></div>}
        </div>
      </section>

      <section className="ops-kpis" data-tour="home-kpis">
        <div className="ops-kpi"><span className="kpi-icon blue">M</span><div><small>6월 마감 진행률</small><strong>94.8%</strong><p>5개 시스템 중 4개 마감</p></div><i>진행</i></div>
        <button className="ops-kpi actionable" type="button" onClick={() => setView("mismatches")}><span className="kpi-icon red">!</span><div><small>미결 대사 예외</small><strong>4건</strong><p>우선 확인 2 · 정상 시차 1</p></div><i>목록</i></button>
        <div className="ops-kpi"><span className="kpi-icon amber">W</span><div><small>내 처리 사건</small><strong>3건</strong><p>담당자 답변 대기 1건</p></div><i>진행</i></div>
        <div className="ops-kpi"><span className="kpi-icon navy">₩</span><div><small>미확정 영향 금액</small><strong>10,000,000원</strong><p>6월 카드매출 기준</p></div><i>집계</i></div>
      </section>

      <section className="content-card reconciliation-card">
        <div className="section-title"><div><span className="section-kicker">PERIOD RECONCILIATION</span><h2>일자·카드사별 대사 결과</h2></div><div className="section-actions"><span>차이가 있는 행을 선택하면 흐름을 추적합니다.</span><button className="text-button" type="button" onClick={() => downloadCsv("6월_카드매출_대사결과.csv", ["일자", "카드사", "POS", "VAN", "카드사 매입", "정산", "ERP", "차이", "상태"], reconciliationRows.map((row) => [row.date, row.card, row.pos, row.van, row.acquired, row.settled, row.erp, row.gap, row.status]))}>엑셀용 CSV ↓</button></div></div>
        <div className="table-scroll"><table><thead><tr><th>영업일</th><th>카드사</th><th>POS 매출</th><th>VAN 승인</th><th>카드사 매입</th><th>정산액</th><th>ERP 반영</th><th>차이</th><th>판정</th></tr></thead>
          <tbody>{reconciliationRows.map((row) => <tr key={row.date} className={row.gap > 0 ? "exception-row" : ""} onClick={() => row.gap > 0 && openCase("VV-20260703-9001", "mismatch")}>
            <td className="mono strong">{row.date}</td><td>{row.card}</td><td>{formatWon(row.pos)}</td><td>{formatWon(row.van)}</td><td>{formatWon(row.acquired)}</td><td>{formatWon(row.settled)}</td><td>{formatWon(row.erp)}</td><td className={row.gap > 0 ? "danger-text strong" : ""}>{formatWon(row.gap)}</td><td><span className={"record-status " + (row.gap > 0 ? "error" : row.status === "정상 시차" ? "waiting" : "resolved")}>{row.status}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className={"incident-hero " + scenario.tone}>
        <div className="incident-icon">!</div><div className="incident-copy"><small>INC-2026-0703-003 · 자동 감지</small><h2>{scenario.eventTitle}</h2><p>{scenario.eventSummary}</p></div>
        <div className="incident-metrics"><div><small>영향 거래</small><strong>{scenario.impactCount}건</strong></div><div><small>영향 금액</small><strong>{formatWon(scenario.impactAmount)}</strong></div><div><small>분류</small><strong>{scenario.classification}</strong></div></div>
        <button type="button" className="white-button" onClick={() => openCase("VV-20260703-9001", "mismatch")}>사건 열기 →</button>
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

function CaseTabs({ active }: { active: "overview" | "trace" | "ai" | "contact" | "history" }) {
  const setView = useSettlementStore((state) => state.setView);
  const tabs: Array<{ id: typeof active; label: string; view: AppView }> = [
    { id: "overview", label: "사건 개요", view: "case" },
    { id: "trace", label: "거래 흐름", view: "trace" },
    { id: "ai", label: "AI 조사", view: "investigation" },
    { id: "contact", label: "담당자 문의", view: "resolution" },
    { id: "history", label: "처리 이력", view: "caseHistory" },
  ];
  return <nav className="case-tabs" aria-label="사건 상세 메뉴">{tabs.map((tab) => <button key={tab.id} type="button" className={active === tab.id ? "active" : ""} onClick={() => setView(tab.view)}>{tab.label}</button>)}</nav>;
}

function CaseOverview({ scenario }: { scenario: Scenario }) {
  const setView = useSettlementStore((state) => state.setView);
  const selectedReference = useSettlementStore((state) => state.selectedReference);
  return (
    <div className="page-stack">
      <PageHeading eyebrow="RECONCILIATION CASE" title="대사 예외 사건 상세" description="자동 대사에서 발견된 예외의 영향 범위와 지금 해야 할 일을 한곳에서 확인합니다."
        actions={<button className="secondary-button" type="button" onClick={() => setView("mismatches")}>← 예외 목록</button>} />
      <CaseTabs active="overview" />
      <section className={"case-summary-hero " + scenario.tone}>
        <div><small>INC-2026-0703-003 · 자동 감지 · {selectedReference}</small><h2>{scenario.eventTitle}</h2><p>{scenario.eventSummary}</p></div>
        <span className={"status-pill " + scenario.tone}>확인 필요</span>
      </section>
      <section className="case-overview-kpis">
        <div><small>최초 이상 구간</small><strong>{scenario.divergence}</strong><span>정상 대기시간 경과 후 감지</span></div>
        <div><small>영향 범위</small><strong>{scenario.impactCount}건 · {formatWon(scenario.impactAmount)}</strong><span>6월 카드매출 마감 기준</span></div>
        <div><small>우선 확인 담당</small><strong>{scenario.recommendedTeam}</strong><span>{scenario.recommendedOwner} 담당자</span></div>
        <div><small>처리 상태</small><strong>원인 조사 전</strong><span>마감 D-1 · 우선순위 높음</span></div>
      </section>
      <section className="content-card case-flow-overview">
        <div className="section-title"><div><span className="section-kicker">DETECTED FLOW</span><h2>자동 대사 결과</h2><p>시스템이 전체 원천을 조회하는 대신 수집 완료 데이터의 연결 키와 금액을 비교해 사건을 만들었습니다.</p></div><button className="text-button" type="button" onClick={() => setView("trace")}>상세 흐름 보기 →</button></div>
        <FlowStrip stages={scenario.flow} compact />
      </section>
      <div className="case-next-layout">
        <section className="content-card case-facts-card"><span className="section-kicker">WHY THIS CASE</span><h2>사건 생성 근거</h2><ul><li><span>1</span>카드사별 정상 매입 대기시간이 지났습니다.</li><li><span>2</span>{scenario.divergence} 구간에서 건수와 금액이 처음 달라졌습니다.</li><li><span>3</span>같은 점포·카드사·배치에 영향 거래가 모여 있습니다.</li></ul></section>
        <aside className="content-card case-next-action"><span className="section-kicker">NEXT ACTION</span><h2>다음 권장 업무</h2><p>거래 흐름을 확인한 뒤 AI 원인 후보를 비교하고 담당자에게 근거와 함께 문의하세요.</p><div><button className="secondary-button" type="button" onClick={() => setView("trace")}>거래 흐름 확인</button><button className="primary-button" type="button" onClick={() => setView("investigation")}>AI 조사 시작 →</button></div></aside>
      </div>
    </div>
  );
}

function CaseHistoryPage({ scenario }: { scenario: Scenario }) {
  const setView = useSettlementStore((state) => state.setView);
  const resolved = useSettlementStore((state) => state.resolved);
  return (
    <div className="page-stack">
      <PageHeading eyebrow="CASE AUDIT TRAIL" title="사건 처리 이력" description="자동 감지부터 조사, 담당자 문의, 재대사까지 현재 사건의 변경 내용을 시간순으로 기록합니다."
        actions={<button className="secondary-button" type="button" onClick={() => setView("mismatches")}>← 예외 목록</button>} />
      <CaseTabs active="history" />
      <section className="content-card case-history-summary"><div><small>사건번호</small><strong>INC-2026-0703-003</strong></div><div><small>현재 상태</small><strong>{resolved ? "해결 완료" : "조사 중"}</strong></div><div><small>영향 범위</small><strong>{scenario.impactCount}건 · {formatWon(scenario.impactAmount)}</strong></div><div><small>담당 영역</small><strong>{scenario.recommendedTeam}</strong></div></section>
      <section className="content-card case-audit-detail"><div className="section-title"><div><span className="section-kicker">AUDIT TIMELINE</span><h2>현재 사건 변경 이력</h2></div><span className="status-pill blue">삭제 불가 기록</span></div><div className="audit-timeline"><HistoryItem time="09:42" title="대사 예외 자동 감지" detail={`${scenario.divergence} · ${scenario.impactCount}건`} state="done"/><HistoryItem time="09:44" title="회계 담당자 사건 확인" detail="마감 우선순위 높음으로 분류" state="done"/><HistoryItem time="09:46" title="AI 원인 조사" detail={`원인 후보 ${scenario.hypotheses.length}개와 우선 담당 영역 추천`} state="done"/><HistoryItem time="10:02" title="담당자 확인 요청" detail={`${scenario.recommendedTeam} · ${scenario.recommendedOwner}`} state={resolved ? "done" : "pending"}/><HistoryItem time={resolved ? "10:28" : "-"} title="재대사 및 사건 종료" detail={resolved ? "원천 데이터 재수집 후 정상 일치" : "담당자 답변과 재처리 결과 대기"} state={resolved ? "done" : "pending"}/></div></section>
    </div>
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
  const [chatMode, setChatMode] = useState<"general" | "hypothesis">("general");
  const [chatInput, setChatInput] = useState("");
  const [chatThinking, setChatThinking] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string; context: string }>>([
    { role: "assistant", context: "전체 사건", text: "현재 사건의 시스템 흐름과 원인 후보를 바탕으로 궁금한 점을 질문해 주세요. 원인을 단정하지 않고 근거와 추가 확인 항목을 함께 설명하겠습니다." },
  ]);

  const runAnalysis = () => { startAnalysis(); window.setTimeout(finishAnalysis, 900); };
  const hypothesis = scenario.hypotheses[selectedHypothesis];
  const startHypothesisChat = (index: number) => {
    const selected = scenario.hypotheses[index];
    selectHypothesis(index);
    setChatMode("hypothesis");
    setChatMessages((messages) => [...messages, {
      role: "assistant",
      context: "후보 " + (index + 1),
      text: "이제 ‘" + selected.title + "’ 후보를 중심으로 대화합니다. 이 후보의 근거, 반대 가능성, 확인할 데이터와 담당 부서를 더 깊게 물어볼 수 있습니다.",
    }]);
    window.setTimeout(() => document.getElementById("ai-investigation-chat")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const buildChatReply = (question: string) => {
    const context = chatMode === "hypothesis" ? hypothesis : scenario.hypotheses[0];
    if (question.includes("왜") || question.includes("근거")) return "이 후보를 우선한 핵심 근거는 " + context.evidence.slice(0, 3).join(", ") + "입니다. 다만 ‘" + context.counterEvidence[0] + "’라는 반대 단서가 있어 확정 원인으로 보지는 않습니다.";
    if (question.includes("틀릴") || question.includes("반대") || question.includes("다른")) return "이 후보가 틀릴 가능성도 있습니다. 현재 반대 근거는 " + context.counterEvidence.join(", ") + "입니다. 이를 구분하려면 " + context.nextChecks.join(", ") + "를 추가로 확인해야 합니다.";
    if (question.includes("담당") || question.includes("문의")) return scenario.recommendedTeam + "의 " + scenario.recommendedOwner + " 담당자에게 먼저 확인하는 것이 효율적입니다. 문의할 핵심 항목은 " + context.nextChecks.join(", ") + "입니다.";
    if (question.includes("데이터") || question.includes("확인") || question.includes("로그")) return "추가 확인 우선순위는 ① " + context.nextChecks.join(" ② ") + "입니다. 확인 결과는 사건 대화에 남겨야 다음 AI 분석과 감사 이력에 활용할 수 있습니다.";
    if (question.includes("쉽게") || question.includes("요약")) return "쉽게 말하면 " + scenario.divergence + " 구간부터 데이터가 달라졌고, 현재 " + scenario.impactCount + "건·" + formatWon(scenario.impactAmount) + "이 확인 대상입니다. 가장 가능성 높은 설명은 ‘" + scenario.hypotheses[0].title + "’입니다.";
    return "질문하신 내용은 현재 데이터만으로 확정하기 어렵습니다. 우선 " + context.summary + " 다음으로 " + context.nextChecks.join(", ") + "를 확인하면 가능성을 더 좁힐 수 있습니다.";
  };
  const sendChat = (question = chatInput) => {
    const trimmed = question.trim();
    if (!trimmed || chatThinking) return;
    const contextLabel = chatMode === "hypothesis" ? "후보 " + (selectedHypothesis + 1) : "전체 사건";
    setChatMessages((messages) => [...messages, { role: "user", context: contextLabel, text: trimmed }]);
    setChatInput("");
    setChatThinking(true);
    window.setTimeout(() => {
      setChatMessages((messages) => [...messages, { role: "assistant", context: contextLabel, text: buildChatReply(trimmed) }]);
      setChatThinking(false);
    }, 550);
  };
  const quickQuestions = chatMode === "hypothesis"
    ? ["왜 이 후보가 우선순위가 높아?", "이 후보가 틀릴 가능성은?", "담당자에게 무엇을 확인해야 해?"]
    : ["이 사건을 쉽게 요약해줘", "어느 담당자에게 먼저 문의해?", "추가로 필요한 데이터는 뭐야?"];

  return (
    <div className="page-stack">
      <CaseTabs active="ai" />
      <PageHeading eyebrow="AI INVESTIGATION WORKBENCH" title="원인 후보를 비교하고 AI와 더 깊게 조사합니다" description="추천 결과를 확인한 뒤 전체 사건 또는 선택한 후보를 문맥으로 고정해 후속 질문을 이어갈 수 있습니다."
        actions={<><button type="button" className="secondary-button" onClick={() => document.getElementById("ai-investigation-chat")?.scrollIntoView({ behavior: "smooth" })}>AI에게 질문</button><button type="button" className="secondary-button" onClick={() => setView("dashboard")}>← 통합 현황</button></>} />
      <section className="content-card trace-card">
        <div className="section-title"><div><span className="section-kicker">FIRST DIVERGENCE</span><h2>{scenario.divergence}</h2></div><span className={"status-pill " + scenario.tone}>{scenario.classification}</span></div>
        <FlowStrip stages={scenario.flow} compact />
      </section>
      {!analyzed ? (
        <section className="analysis-empty">
          {analyzing ? <><div className="analysis-loader"><span/><span/><span/></div><h2>관련 단서를 교차 분석하고 있습니다</h2><p>거래시간, 배치 로그, 마스터 변경, 과거 유사 사례를 비교합니다.</p><div className="analysis-steps"><span className="done">거래 흐름 연결</span><span className="active">원인 후보 비교</span><span>담당자 추천</span></div></>
          : <><div className="analysis-mark">AI</div><h2>불일치 숫자만으로는 원인을 확정할 수 없습니다</h2><p>주변 이력을 함께 비교해 먼저 확인할 가설과 담당자를 추천합니다.</p><div className="source-chips"><span>거래 100건</span><span>배치 로그 4개</span><span>마스터 변경 2개</span><span>유사 사례 8건</span></div><button type="button" className="primary-button" onClick={runAnalysis}>AI 조사 시작하기 <span>→</span></button></>}
        </section>
      ) : (
        <>
          <div className="analysis-layout" data-tour="ai-investigation">
            <section className="hypothesis-panel content-card">
              <div className="section-title"><div><span className="section-kicker">RANKED HYPOTHESES</span><h2>원인 후보</h2></div><small>근거 일치도 기준</small></div>
              <div className="hypothesis-list">{scenario.hypotheses.map((item, index) => (
                <article key={item.title} className={"hypothesis-card " + (selectedHypothesis === index ? "selected" : "")}>
                  <button type="button" className="hypothesis-select" onClick={() => selectHypothesis(index)}>
                    <span className="rank">{index + 1}</span><div><small>조사 우선순위 {index + 1}</small><h3>{item.title}</h3><p>{item.summary}</p><div className="confidence-row"><span>근거 일치도 {item.confidence}</span><div><i style={{ width: item.score + "%" }} /></div><strong>{item.score}</strong></div></div>
                  </button>
                  <button type="button" className="deep-chat-launch" onClick={() => startHypothesisChat(index)}><span>AI</span> 이 후보로 심층 대화 <i>→</i></button>
                </article>
              ))}</div>
            </section>
            <section className="evidence-panel content-card">
              <div className="evidence-head"><div><small>선택한 가설</small><h2>{hypothesis.title}</h2></div><span className={"confidence-badge " + (hypothesis.confidence === "높음" ? "high" : hypothesis.confidence === "중간" ? "medium" : "low")}>일치도 {hypothesis.confidence}</span></div>
              <p className="evidence-summary">{hypothesis.summary}</p>
              <EvidenceList title="판단 근거" tone="positive" items={hypothesis.evidence} />
              <EvidenceList title="반대 근거·불확실성" tone="negative" items={hypothesis.counterEvidence} />
              <EvidenceList title="다음 확인 항목" tone="next" items={hypothesis.nextChecks} />
              <div className="evidence-actions"><button className="ai-deep-button" type="button" onClick={() => startHypothesisChat(selectedHypothesis)}><span>AI</span><div><small>선택 후보 문맥으로</small><strong>심층 대화 시작</strong></div><i>→</i></button><button className="primary-button small" type="button" onClick={() => setView("resolution")}>업무 요청 준비 →</button></div>
              <div className="owner-recommendation"><span className="owner-avatar">{scenario.recommendedOwner.slice(0, 1)}</span><div><small>우선 확인 추천</small><strong>{scenario.recommendedTeam}</strong><p>{scenario.recommendedOwner} 담당자</p></div></div>
            </section>
          </div>

          <section className="content-card ai-chat-workbench" id="ai-investigation-chat">
            <div className="ai-chat-header">
              <div><span className="section-kicker">CONTEXTUAL AI CHAT</span><h2>AI 조사 대화</h2><p>사건 전체를 묻거나, 선택한 원인 후보를 고정해 근거와 반대 가능성을 더 깊게 확인합니다.</p></div>
              <div className="ai-chat-tabs"><button type="button" className={chatMode === "general" ? "active" : ""} onClick={() => setChatMode("general")}>전체 사건 질문</button><button type="button" className={chatMode === "hypothesis" ? "active" : ""} onClick={() => setChatMode("hypothesis")}>후보 {selectedHypothesis + 1} 심층 질문</button></div>
            </div>
            <div className="ai-chat-context">
              <span>{chatMode === "hypothesis" ? "선택한 원인 후보" : "현재 사건"}</span>
              <strong>{chatMode === "hypothesis" ? hypothesis.title : scenario.eventTitle}</strong>
              <div><small>최초 이상</small><b>{scenario.divergence}</b><small>영향</small><b>{scenario.impactCount}건 · {formatWon(scenario.impactAmount)}</b>{chatMode === "hypothesis" && <><small>일치도</small><b>{hypothesis.score}</b></>}</div>
            </div>
            <div className="ai-chat-layout">
              <div className="ai-chat-messages">
                {chatMessages.map((message, index) => <div className={"ai-chat-message " + message.role} key={index}><span>{message.role === "assistant" ? "AI" : "회"}</span><div><small>{message.context} · {message.role === "assistant" ? "FlowScope AI" : "회계 담당자"}</small><p>{message.text}</p></div></div>)}
                {chatThinking && <div className="ai-chat-message assistant thinking"><span>AI</span><div><small>근거를 확인하는 중</small><p><i/><i/><i/></p></div></div>}
              </div>
              <aside className="ai-chat-side">
                <div><small>추천 질문</small><h3>{chatMode === "hypothesis" ? "이 후보를 더 검증해보세요" : "사건 전체부터 물어보세요"}</h3></div>
                <div className="quick-question-list">{quickQuestions.map((question) => <button type="button" key={question} onClick={() => sendChat(question)}>{question}<span>→</span></button>)}</div>
                {chatMode === "hypothesis" && <div className="chat-evidence-summary"><small>현재 문맥</small><strong>후보 {selectedHypothesis + 1} · {hypothesis.confidence}</strong><p>{hypothesis.evidence.length}개 근거와 {hypothesis.counterEvidence.length}개 반대 근거를 참조합니다.</p></div>}
              </aside>
            </div>
            <div className="ai-chat-composer"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChat(); } }} placeholder={chatMode === "hypothesis" ? "이 후보의 근거나 반대 가능성을 더 물어보세요." : "현재 사건에 대해 무엇이든 물어보세요."}/><div><small>Enter 전송 · Shift+Enter 줄바꿈</small><button type="button" disabled={!chatInput.trim() || chatThinking} onClick={() => sendChat()}>질문 보내기 <span>↑</span></button></div></div>
            <p className="ai-chat-disclaimer">데모 응답입니다. 실제 구현에서는 사건 데이터와 권한 범위 내 로그만 검색하고, 답변에 사용한 근거를 함께 저장합니다.</p>
          </section>
        </>
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
  const [contactType, setContactType] = useState<"van" | "settlement" | "erp" | "pos">("van");
  const contactProfiles = {
    van: { label: "VAN 인터페이스", team: "VAN 인터페이스팀", owner: "이도현", badge: "AI 1순위", reason: "승인 이후 카드사 매입 전달 구간을 먼저 확인", terms: ["승인번호", "전문 전송", "응답코드", "배치번호", "재전송"], checks: ["배치 BATCH-20260701-03의 부분 실패 여부", "영향 승인번호 5건의 카드사 송신 결과", "실패 전문 재전송 및 응답코드"] },
    settlement: { label: "정산 운영", team: "카드 정산 운영팀", owner: "박서연", badge: "대안 담당", reason: "매입 대상 포함 여부와 정산 제외 조건을 확인", terms: ["매입 대상", "정산번호", "입금 예정일", "수수료", "정산 제외"], checks: ["정산 대상에서 제외된 거래 존재 여부", "카드사 매입 확정일과 입금 예정일", "취소·수수료·부분 입금 반영 내역"] },
    erp: { label: "ERP 회계", team: "ERP 회계시스템팀", owner: "최민준", badge: "후속 확인", reason: "전표 집계와 원천 연결이 맞는지 확인", terms: ["전표번호", "집계 규칙", "점포 코드", "계정과목", "인터페이스"], checks: ["전표 JV-20260703-9001의 원천 연결 결과", "점포·가맹점 코드 매핑 상태", "전표 생성 인터페이스 오류 로그"] },
    pos: { label: "점포 POS", team: "점포 POS 운영팀", owner: "김하늘", badge: "원천 확인", reason: "원거래·반품·단말기 취소 기록을 확인", terms: ["POS 거래번호", "영업일", "원거래", "반품 처리", "단말기 취소"], checks: ["POS 원장에 원거래와 취소가 함께 존재하는지", "카드 단말기 단독 취소 여부", "영업일 마감 이후 취소 반영일"] },
  } as const;
  const selectedContact = contactProfiles[contactType];
  const generatedRequest = `[INC-2026-0703-003] ${selectedContact.team} 확인 요청\n\n안녕하세요. ${scenario.divergence} 구간에서 ${scenario.impactCount}건, ${formatWon(scenario.impactAmount)}의 대사 차이가 확인되었습니다.\n\n확인 부탁드리는 항목\n1. ${selectedContact.checks[0]}\n2. ${selectedContact.checks[1]}\n3. ${selectedContact.checks[2]}\n\n확인 결과와 조치 예정 시각을 사건번호와 함께 회신 부탁드립니다.`;
  const selectContact = (type: keyof typeof contactProfiles) => { setContactType(type); assignOwner(""); setMessageSent(false); };
  const runReconciliation = () => { startReprocess(); window.setTimeout(finishReprocess, 1000); };
  const copyMessage = async () => { await navigator.clipboard?.writeText(generatedRequest); setCopied(true); window.setTimeout(() => setCopied(false), 1200); };
  const addReply = () => { if (!replyText.trim()) return; setReplies((items) => [...items, replyText.trim()]); setReplyText(""); };

  if (!analyzed) return <div className="page-stack"><PageHeading eyebrow="CASE WORKFLOW" title="먼저 AI 조사를 실행해 주세요" description="조사 결과가 만들어지면 담당자 요청과 확인 흐름을 이어갈 수 있습니다."/><section className="analysis-empty"><div className="analysis-mark">04</div><h2>AI 조사 결과가 아직 없습니다</h2><p>원인 후보와 담당자를 확인한 후 사건 처리를 시작합니다.</p><button className="primary-button" type="button" onClick={() => setView("investigation")}>AI 조사 화면으로 이동 →</button></section></div>;

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CASE WORKFLOW" title="담당자 문의와 처리 근거를 한 사건에 기록합니다" description="외부 메신저에는 알림과 링크를 보내고, 확인 내용과 조치 결과는 사건 화면에 남기는 데모입니다." />
      <CaseTabs active="contact" />
      {resolved && <section className="resolved-banner"><div className="resolved-check">✓</div><div><small>INC-2026-0703-003</small><h2>최신 데이터를 다시 대사해 정상화를 확인했습니다</h2><p>확정 원인과 조치 결과가 유사 사례 지식으로 저장됐습니다.</p></div><span>해결 완료</span></section>}

      <div className="resolution-layout" data-tour="case-resolution">
        <section className="content-card action-panel">
          <div className="section-title"><div><span className="section-kicker">RECIPIENT-AWARE AI REQUEST</span><h2>담당 영역별 확인 요청</h2><p>상대 담당자가 바로 이해할 수 있도록 용어와 확인 항목을 자동으로 바꿉니다.</p></div><span className={"status-pill " + (resolved ? "blue" : scenario.tone)}>{resolved ? "처리 완료" : "AI 문의 준비"}</span></div>
          <div className="contact-profile-grid">{(Object.entries(contactProfiles) as Array<[keyof typeof contactProfiles, typeof selectedContact]>).map(([id, profile]) => <button type="button" key={id} className={contactType === id ? "active" : ""} onClick={() => selectContact(id)}><div><span>{profile.label.slice(0, 2)}</span><i>{profile.badge}</i></div><strong>{profile.label}</strong><small>{profile.reason}</small></button>)}</div>
          <div className="ai-language-preview"><div><span className="ai-mini-mark">AI</span><div><small>선택 담당자 기준 용어</small><strong>{selectedContact.team}에게는 이렇게 표현합니다</strong></div></div><div className="terminology-chips">{selectedContact.terms.map((term) => <span key={term}>{term}</span>)}</div><ul>{selectedContact.checks.map((check) => <li key={check}><span>→</span>{check}</li>)}</ul></div>
          <div className="owner-box"><span className="owner-avatar large">{selectedContact.owner.slice(0, 1)}</span><div><small>{contactType === "van" ? "AI 우선 추천 담당 영역" : "선택한 확인 담당 영역"}</small><h3>{selectedContact.team}</h3><p>{selectedContact.owner} 담당자 · {selectedContact.reason}</p></div><button type="button" className={assignedOwner ? "assigned-button" : "secondary-button"} onClick={() => assignOwner(selectedContact.owner)}>{assignedOwner ? "✓ 배정 완료" : "담당자 배정"}</button></div>
          <div className="field-group"><label htmlFor="request-message">AI 추천 문의문 · {selectedContact.label} 용어 적용</label><textarea id="request-message" readOnly value={requestGenerated ? generatedRequest : `${selectedContact.team}에 맞는 용어와 확인 항목으로 문의문을 생성할 수 있습니다.`} /></div>
          <div className="button-row"><button className="primary-button" type="button" onClick={generateRequest}>이 담당자용 문의문 생성</button><button className="secondary-button" type="button" disabled={!requestGenerated} onClick={copyMessage}>{copied ? "복사 완료" : "내용 복사"}</button><button className="secondary-button" type="button" disabled={!requestGenerated || !assignedOwner} onClick={() => setMessageSent(true)}>{messageSent ? "✓ Teams 알림 전송됨" : "Teams로 알림 보내기"}</button></div>
          <div className="audit-note"><span>AI 적용 원칙</span> 담당자를 바꾸면 용어·확인 항목·문의문이 함께 바뀌며, 최종 전송 전 회계 담당자가 내용을 확인합니다.</div>
        </section>

        <section className="content-card conversation-panel">
          <div className="section-title"><div><span className="section-kicker">CASE CONVERSATION</span><h2>사건 대화</h2></div><small>{messageSent ? "담당자 알림 완료" : "알림 전송 전"}</small></div>
          <div className="message-list">
            <div className="message-bubble system"><small>07-03 09:44 · 회계 담당자</small><strong>확인 요청</strong><p>{requestGenerated ? generatedRequest : "문의문을 생성하면 이곳에 사건 메시지로 기록됩니다."}</p></div>
            {messageSent && <div className="message-bubble owner"><small>07-03 10:02 · {selectedContact.owner}</small><strong>담당자 답변</strong><p>해당 배치와 원천 로그를 확인하겠습니다. 처리 결과와 대상 거래번호를 이 사건에 남기겠습니다.</p></div>}
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
          <HistoryItem time={assignedOwner ? "09:46" : "—"} title="담당자 확인 요청" detail={assignedOwner ? selectedContact.team + " · " + assignedOwner : "대기 중"} state={assignedOwner ? "done" : "pending"} />
          <HistoryItem time={resolved ? "10:18" : "—"} title="재수집 및 재대사" detail={resolved ? "5단계 정상 연결" : "대기 중"} state={resolved ? "done" : "pending"} />
        </div>
      </section>
    </div>
  );
}

function HistoryItem({ time, title, detail, state }: { time: string; title: string; detail: string; state: string }) {
  return <div className={`history-item ${state}`}><span className="history-dot">{state === "done" ? "✓" : ""}</span><small>{time}</small><strong>{title}</strong><p>{detail}</p></div>;
}





function CardCompanyRulesPage() {
  const [selectedCard, setSelectedCard] = useState("현대카드");
  const [simulation, setSimulation] = useState<"waiting" | "overdue">("waiting");
  const cardRules = [
    { name: "현대카드", code: "HY", merchant: "강남점 외 12개 가맹점", acquisitionCutoff: "23:30", acquisitionWait: "마감 후 1영업일", depositCycle: "매입일 + 2영업일", holiday: "다음 영업일 이월", cancel: "매입 전 당일 상계 · 이후 차기 정산", fee: "매입 확정액 기준 계약 요율", expected: "2026-07-03", updated: "2026-06-15", version: "v3.2", tone: "blue" },
    { name: "KB국민카드", code: "KB", merchant: "전 점포 18개 가맹점", acquisitionCutoff: "22:30", acquisitionWait: "마감 후 1영업일", depositCycle: "매입일 + 3영업일", holiday: "다음 영업일 이월", cancel: "원승인 연결 후 차기 정산 반영", fee: "가맹점별 계약 요율", expected: "2026-07-06", updated: "2026-06-01", version: "v2.8", tone: "amber" },
    { name: "삼성카드", code: "SS", merchant: "백화점 카드 가맹점 14개", acquisitionCutoff: "23:00", acquisitionWait: "마감 후 1영업일", depositCycle: "매입일 + 2영업일", holiday: "다음 영업일 이월", cancel: "매입 완료 취소는 다음 영업일 차감", fee: "정산 원장 수수료 합계", expected: "2026-07-03", updated: "2026-06-20", version: "v4.1", tone: "navy" },
    { name: "신한카드", code: "SH", merchant: "전 점포 20개 가맹점", acquisitionCutoff: "23:40", acquisitionWait: "마감 후 1영업일", depositCycle: "매입일 + 2영업일", holiday: "다음 영업일 이월", cancel: "마감 이후 취소는 차기 회차 상계", fee: "매입액 × 계약 요율", expected: "2026-07-03", updated: "2026-06-18", version: "v3.7", tone: "green" },
    { name: "BC카드", code: "BC", merchant: "제휴 가맹점 9개", acquisitionCutoff: "22:00", acquisitionWait: "마감 후 2영업일", depositCycle: "매입일 + 3영업일", holiday: "다음 영업일 이월", cancel: "회원사별 정산 회차에 반영", fee: "회원사·가맹점별 계약 요율", expected: "2026-07-06", updated: "2026-05-28", version: "v2.4", tone: "violet" },
  ];
  const activeRule = cardRules.find((rule) => rule.name === selectedCard) ?? cardRules[0];
  const simulationResult = simulation === "waiting"
    ? { label: "정상 대기", tone: "waiting", title: "아직 예외를 만들지 않습니다", detail: `${activeRule.name}의 정상 매입 대기시간 ${activeRule.acquisitionWait} 안에 있습니다.` }
    : { label: "예외 생성", tone: "error", title: "입금 예정일 경과 사건을 생성합니다", detail: `${activeRule.expected}까지 입금 연결이 없어 정산 담당자 확인 대상으로 분류합니다.` };

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CARD COMPANY OPERATING RULES" title="카드사 처리 기준" description="카드사·가맹점 계약 기준으로 정상 매입 대기시간과 입금 예정일을 계산합니다."
        actions={<button className="secondary-button" type="button">규칙 변경 이력 12건</button>} />
      <section className="rule-assumption-banner"><span>DEMO RULE</span><div><strong>현재 값은 화면 검증을 위한 가정값입니다.</strong><p>실제 운영에서는 카드사명만으로 고정하지 않고 가맹점번호·계약·점포별 기준과 시행일을 등록해야 합니다.</p></div></section>
      <section className="rule-summary-kpis"><div><small>관리 카드사</small><strong>5개</strong><span>현대·국민·삼성·신한·BC</span></div><div><small>적용 중 규칙</small><strong>14개</strong><span>가맹점·정산 주기 기준</span></div><div><small>정상 대기 거래</small><strong>23건</strong><span>아직 문의하지 않음</span></div><div className="alert"><small>오늘 확인 예정</small><strong>3건</strong><span>입금 예정일 도래</span></div></section>

      <div className="card-rule-workspace">
        <aside className="content-card card-company-list">
          <div className="section-title"><div><span className="section-kicker">CARD COMPANIES</span><h2>카드사 선택</h2></div><small>5개 카드사</small></div>
          <div className="card-company-buttons">{cardRules.map((rule) => <button type="button" key={rule.name} className={selectedCard === rule.name ? "active" : ""} onClick={() => setSelectedCard(rule.name)}><span className={rule.tone}>{rule.code}</span><div><strong>{rule.name}</strong><small>입금 기준 {rule.depositCycle}</small></div><i>→</i></button>)}</div>
        </aside>

        <section className="content-card card-rule-detail">
          <div className="card-rule-detail-head"><div><span className={"company-code " + activeRule.tone}>{activeRule.code}</span><div><small>선택 카드사</small><h2>{activeRule.name} 처리 기준</h2><p>{activeRule.merchant}</p></div></div><div><span className="record-status resolved">적용 중</span><small>{activeRule.version} · {activeRule.updated} 변경</small></div></div>
          <div className="rule-definition-grid"><div><small>매입 마감시간</small><strong>{activeRule.acquisitionCutoff}</strong><span>마감 이후 건은 다음 회차</span></div><div><small>정상 매입 대기</small><strong>{activeRule.acquisitionWait}</strong><span>이 시간 안에는 예외 미생성</span></div><div><small>입금 예정 기준</small><strong>{activeRule.depositCycle}</strong><span>영업일 캘린더 적용</span></div><div><small>휴일 처리</small><strong>{activeRule.holiday}</strong><span>은행 영업일 기준</span></div><div><small>취소 반영</small><strong>{activeRule.cancel}</strong><span>원승인 연결 필수</span></div><div><small>수수료 기준</small><strong>{activeRule.fee}</strong><span>계약 요율 버전 보존</span></div></div>
          <div className="settlement-schedule"><div><span>01</span><small>승인</small><strong>06-30 21:20</strong></div><i>→</i><div><span>02</span><small>매입 마감</small><strong>{activeRule.acquisitionCutoff}</strong></div><i>→</i><div><span>03</span><small>매입 확정</small><strong>07-01</strong></div><i>→</i><div className="accent"><span>04</span><small>예상 입금일</small><strong>{activeRule.expected}</strong></div></div>
          <div className="rule-source-row"><div><small>규칙 적용 범위</small><strong>{activeRule.merchant}</strong></div><div><small>기준 출처</small><strong>가맹점 계약서 · 정산 운영 합의</strong></div><div><small>다음 검토일</small><strong>2026-09-30</strong></div></div>
        </section>
      </div>

      <section className="content-card rule-simulator">
        <div className="section-title"><div><span className="section-kicker">DETECTION SIMULATOR</span><h2>이 기준이 예외 탐지에 사용되는 방식</h2><p>같은 미반영 거래라도 카드사 기준 시각을 넘었는지에 따라 정상 대기와 조사 사건을 구분합니다.</p></div><div className="period-tabs"><button type="button" className={simulation === "waiting" ? "active" : ""} onClick={() => setSimulation("waiting")}>대기시간 안</button><button type="button" className={simulation === "overdue" ? "active" : ""} onClick={() => setSimulation("overdue")}>예정일 경과</button></div></div>
        <div className="rule-simulation-flow"><div><small>대상 거래</small><strong>POS-20260630-0041</strong><span>{activeRule.name} · 승인 100,000원</span></div><div><small>현재 확인 시각</small><strong>{simulation === "waiting" ? "2026-07-01 09:30" : "2026-07-07 09:30"}</strong><span>영업일 캘린더 반영</span></div><div><small>적용 규칙</small><strong>{activeRule.depositCycle}</strong><span>예상 입금 {activeRule.expected}</span></div><div className={"simulation-result " + simulationResult.tone}><span>{simulationResult.label}</span><strong>{simulationResult.title}</strong><p>{simulationResult.detail}</p></div></div>
      </section>
    </div>
  );
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

function ErpJournalPage({ scenario }: { scenario: Scenario }) {
  const openTrace = useSettlementStore((state) => state.openTrace);
  const [periodPreset, setPeriodPreset] = useState<"month" | "week" | "day" | "custom">("month");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [storeFilter, setStoreFilter] = useState("전체");
  const [cadenceFilter, setCadenceFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("전체");
  const [selectedJournalId, setSelectedJournalId] = useState("JV-20260703-9001");
  const [selectedDate, setSelectedDate] = useState("06-30");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "sales" | "validation" | "lines" | "history">("overview");

  const journals = [
    { id: "JV-20260703-9001", createdAt: "2026-07-03", period: "2026-06-01 ~ 2026-06-30", store: "강남점", card: "신한카드", cadence: "월마감", rule: "카드매출 월마감", sources: 2412, gross: 1_240_000_000, fee: 21_080_000, net: 1_218_920_000, status: "상위 단계 확인", erpIssue: false, sourceGap: 0, note: scenario.divergence + " 구간에서 " + scenario.impactCount + "건 확인 필요" },
    { id: "JV-20260703-9002", createdAt: "2026-07-03", period: "2026-06-01 ~ 2026-06-30", store: "강남점", card: "삼성카드", cadence: "월마감", rule: "카드매출 월마감", sources: 1870, gross: 876_543_000, fee: 14_901_231, net: 861_641_769, status: "정상", erpIssue: false, sourceGap: 0, note: "예상 전표와 원천 구성이 모두 일치" },
    { id: "JV-20260701-7204", createdAt: "2026-07-01", period: "2026-06-23 ~ 2026-06-30", store: "본점", card: "KB국민카드", cadence: "주마감", rule: "카드매출 주마감", sources: 531, gross: 320_000_000, fee: 5_440_000, net: 314_560_000, status: "정상", erpIssue: false, sourceGap: 0, note: "주간 집계 규칙과 원천 연결 정상" },
    { id: "JV-20260701-7211", createdAt: "2026-07-01", period: "2026-06-30", store: "무역센터점", card: "롯데카드", cadence: "일마감", rule: "카드매출 일마감", sources: 82, gross: 110_000_000, fee: 1_870_000, net: 108_130_000, status: "ERP 원천 누락", erpIssue: true, sourceGap: 2, note: "정산 원천 82건 중 ERP 연결 80건" },
    { id: "JV-20260703-9012", createdAt: "2026-07-03", period: "2026-06-01 ~ 2026-06-30", store: "신촌점", card: "현대카드", cadence: "월마감", rule: "카드매출 월마감", sources: 1644, gross: 742_300_000, fee: 12_619_100, net: 729_680_900, status: "정상", erpIssue: false, sourceGap: 0, note: "예상 전표와 원천 구성이 모두 일치" },
    { id: "JV-20260701-7230", createdAt: "2026-07-01", period: "2026-06-23 ~ 2026-06-30", store: "목동점", card: "하나카드", cadence: "주마감", rule: "카드매출 주마감", sources: 418, gross: 236_500_000, fee: 4_020_500, net: 232_479_500, status: "정상", erpIssue: false, sourceGap: 0, note: "주간 집계 규칙과 원천 연결 정상" },
  ];

  const ruleCatalog = [
    { code: "RULE-CARD-M01", name: "카드매출 월마감", cycle: "월 1회", applies: "일반 카드매출", keys: ["대상 기간", "점포", "카드사", "결제수단"] },
    { code: "RULE-CARD-W01", name: "카드매출 주마감", cycle: "주 1회", applies: "주간 정산 점포", keys: ["대상 주차", "점포", "카드사", "정산배치"] },
    { code: "RULE-CARD-D01", name: "카드매출 일마감", cycle: "매 영업일", applies: "일마감 대상 점포", keys: ["영업일", "점포", "카드사", "가맹점번호"] },
  ];

  const formatCalendarDate = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const rangeLabel = dateRange?.from
    ? dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime()
      ? formatCalendarDate(dateRange.from) + " ~ " + formatCalendarDate(dateRange.to)
      : formatCalendarDate(dateRange.from)
    : "기간을 선택하세요";
  const selectPeriodPreset = (value: "month" | "week" | "day") => {
    setPeriodPreset(value);
    setDateRange(value === "month"
      ? { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) }
      : value === "week"
        ? { from: new Date(2026, 5, 23), to: new Date(2026, 5, 30) }
        : { from: new Date(2026, 5, 30), to: new Date(2026, 5, 30) });
    setCalendarOpen(false);
  };
  const updateDateRange = (range: DateRange | undefined) => {
    setDateRange(range);
    setPeriodPreset("custom");
  };
  const visibleJournals = journals.filter((journal) => {
    const presetMatch = periodPreset === "month" || periodPreset === "custom" || (periodPreset === "week" ? journal.cadence !== "월마감" : journal.cadence === "일마감");
    return presetMatch && (storeFilter === "전체" || journal.store === storeFilter) && (cadenceFilter === "전체" || journal.cadence === cadenceFilter) && (statusFilter === "전체" || journal.status === statusFilter);
  });
  const selectedJournal = journals.find((journal) => journal.id === selectedJournalId) ?? journals[0];
  const selectedRule = ruleCatalog.find((rule) => rule.name === selectedJournal.rule) ?? ruleCatalog[0];
  const journalNeedsReview = selectedJournal.erpIssue;
  const endDate = selectedJournal.period.includes(" ~ ") ? selectedJournal.period.split(" ~ ")[1].slice(5) : selectedJournal.period.slice(5);
  const dateLabels = selectedJournal.cadence === "일마감" ? [endDate] : selectedJournal.cadence === "주마감" ? ["06-27", "06-28", "06-29", "06-30"] : ["06-27", "06-28", "06-29", "06-30"];
  const ratios = selectedJournal.cadence === "일마감" ? [1] : [.18, .22, .24, .36];
  const dayRows = dateLabels.map((date, index) => {
    const last = index === dateLabels.length - 1;
    const gross = Math.round(selectedJournal.gross * ratios[index]);
    const settled = Math.round(gross * .983);
    const gap = last && selectedJournal.status !== "정상" ? (selectedJournal.erpIssue ? 1_850_000 : scenario.impactAmount) : 0;
    return {
      date,
      sales: Math.max(1, Math.round(selectedJournal.sources * ratios[index])),
      gross,
      acquired: selectedJournal.status === "상위 단계 확인" && last ? gross - scenario.impactAmount : gross,
      settled: selectedJournal.status === "상위 단계 확인" && last ? Math.max(0, settled - scenario.impactAmount) : settled,
      linked: Math.max(0, Math.round(selectedJournal.sources * ratios[index]) - (last ? selectedJournal.sourceGap : 0)),
      gap,
      status: gap > 0 ? selectedJournal.status : "정상",
    };
  });
  const selectedDay = dayRows.find((row) => row.date === selectedDate) ?? dayRows[dayRows.length - 1];
  const actualLinked = selectedJournal.sources - selectedJournal.sourceGap;
  const journalLines = [
    { no: 1, side: "차변", account: "카드정산미수금", amount: selectedJournal.net, memo: selectedJournal.period + " 카드 정산 예정액" },
    { no: 2, side: "차변", account: "지급수수료", amount: selectedJournal.fee, memo: selectedJournal.card + " 수수료" },
    { no: 3, side: "대변", account: "카드매출미수금", amount: selectedJournal.gross, memo: selectedJournal.store + " 매입 확정 카드매출" },
  ];
  const selectJournal = (journal: (typeof journals)[number]) => {
    setSelectedJournalId(journal.id);
    const nextDate = journal.period.includes(" ~ ") ? journal.period.split(" ~ ")[1].slice(5) : journal.period.slice(5);
    setSelectedDate(nextDate);
    setDetailOpen(true);
    setDetailTab("overview");
  };

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ERP JOURNAL CONTROL" title={detailOpen ? "ERP 전표 상세" : "ERP 전표 조회"} description={detailOpen ? "선택한 전표의 집계 규칙, 포함 매출, 검증 결과를 필요한 항목별로 확인합니다." : "기간과 조건으로 전표를 찾은 뒤 한 건을 열어 상세 검증합니다."}
        actions={detailOpen ? <><button className="secondary-button" type="button" onClick={() => setDetailOpen(false)}>← 전표 목록</button><button className="primary-button small" type="button" onClick={() => downloadTransactions(scenario)}>포함 매출 CSV ↓</button></> : undefined} />

      {!detailOpen && <>
      <section className="content-card journal-filter-card">
        <div className="journal-filter-heading"><div><span className="section-kicker">SEARCH CONDITIONS</span><h2>전표 조회 조건</h2><p>조회 기간은 전표 목록을 찾는 조건이고, 각 전표의 대상 기간은 목록에서 별도로 확인합니다.</p></div><div className="period-tabs">{[["month", "6월 전체"], ["week", "마지막 주"], ["day", "6월 30일"]].map(([value, label]) => <button type="button" key={value} className={periodPreset === value ? "active" : ""} onClick={() => selectPeriodPreset(value as "month" | "week" | "day")}>{label}</button>)}</div></div>
        <div className="journal-filter-grid">
          <div className="calendar-range-field"><span>조회 기간</span><button className="calendar-range-trigger" type="button" aria-expanded={calendarOpen} onClick={() => setCalendarOpen((open) => !open)}><i>▣</i><strong>{rangeLabel}</strong><em>{calendarOpen ? "닫기" : "달력 열기"}</em></button>
            {calendarOpen && <div className="calendar-popover">
              <DayPicker animate mode="range" selected={dateRange} onSelect={updateDateRange} defaultMonth={new Date(2026, 5, 1)} numberOfMonths={2} locale={ko} weekStartsOn={1} resetOnSelect />
              <div className="calendar-popover-footer"><div><small>선택한 조회 기간</small><strong>{rangeLabel}</strong></div><button type="button" disabled={!dateRange?.from || !dateRange?.to} onClick={() => setCalendarOpen(false)}>이 기간 적용</button></div>
            </div>}
          </div>
          <label><span>점포</span><select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option>전체</option>{["강남점", "본점", "무역센터점", "신촌점", "목동점"].map((store) => <option key={store}>{store}</option>)}</select></label>
          <label><span>집계 주기</span><select value={cadenceFilter} onChange={(event) => setCadenceFilter(event.target.value)}><option>전체</option><option>일마감</option><option>주마감</option><option>월마감</option></select></label>
          <label><span>검증 결과</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>전체</option><option>정상</option><option>상위 단계 확인</option><option>ERP 원천 누락</option></select></label>
        </div>
      </section>

      <section className="journal-kpis">
        <div className="content-card"><small>조회된 전표</small><strong>{visibleJournals.length}건</strong><span>현재 필터 기준</span></div>
        <div className="content-card"><small>정상 전표</small><strong>{visibleJournals.filter((item) => item.status === "정상").length}건</strong><span>금액·원천 일치</span></div>
        <div className="content-card alert"><small>상위 단계 확인</small><strong>{visibleJournals.filter((item) => item.status === "상위 단계 확인").length}건</strong><span>ERP 자체는 정상</span></div>
        <div className="content-card alert"><small>ERP 확인 필요</small><strong>{visibleJournals.filter((item) => item.erpIssue).length}건</strong><span>원천 연결 불일치</span></div>
      </section>

      <div className="erp-overview-layout" data-tour="journal-validation">
        <section className="content-card journal-master-card">
          <div className="section-title"><div><span className="section-kicker">JOURNAL LIST</span><h2>조회된 전표 목록</h2><p>전표를 선택하면 아래의 집계 규칙과 포함 매출이 해당 전표 기준으로 바뀝니다.</p></div><span className="status-pill blue">선택 {selectedJournal.id}</span></div>
          <div className="table-scroll journal-master-table"><table><thead><tr><th>전표번호</th><th>대상 기간</th><th>점포·카드사</th><th>집계 규칙</th><th>원천 거래</th><th>정산액</th><th>검증 결과</th></tr></thead><tbody>
            {visibleJournals.map((journal) => <tr key={journal.id} className={selectedJournal.id === journal.id ? "selected-row" : ""} onClick={() => selectJournal(journal)}><td className="mono strong">{journal.id}</td><td>{journal.period}</td><td><strong>{journal.store}</strong><small>{journal.card}</small></td><td><strong>{journal.rule}</strong><small>{journal.cadence}</small></td><td>{journal.sources.toLocaleString()}건</td><td>{formatWon(journal.net)}</td><td><span className={"record-status " + (journal.erpIssue ? "error" : journal.status === "정상" ? "resolved" : "waiting")}>{journal.status}</span></td></tr>)}
          </tbody></table>{visibleJournals.length === 0 && <div className="empty-table">조회 조건에 맞는 전표가 없습니다.</div>}</div>
        </section>

        <aside className="content-card journal-rule-catalog">
          <div className="section-title"><div><span className="section-kicker">REGISTERED RULES</span><h2>등록된 집계 규칙</h2><p>회사가 사용하는 대표 전표 생성 규칙입니다.</p></div></div>
          <div className="rule-catalog-list">{ruleCatalog.map((rule) => <div className={"rule-catalog-item " + (rule.name === selectedRule.name ? "active" : "")} key={rule.code}><div><small>{rule.code} · {rule.cycle}</small><strong>{rule.name}</strong><p>{rule.applies}</p></div><div>{rule.keys.map((key) => <span key={key}>{key}</span>)}</div></div>)}</div>
        </aside>
      </div>
      </>}
      {detailOpen && <>

      <section className={"journal-focus " + (journalNeedsReview ? "red" : "blue")}>
        <div><span className="section-kicker">SELECTED JOURNAL</span><h2>{selectedJournal.id} · {selectedJournal.store} {selectedJournal.card} {selectedJournal.cadence}</h2><p>대상기간 {selectedJournal.period} · 생성일 {selectedJournal.createdAt} · 적용 규칙 {selectedJournal.rule}</p></div>
        <div className="reverse-route"><span>ERP 전표 1건</span><i>←</i><span>{selectedJournal.cadence === "월마감" ? "월간 일자" : selectedJournal.cadence === "주마감" ? "주간 일자" : "영업일 1일"}</span><i>←</i><span>원천 {selectedJournal.sources.toLocaleString()}건</span></div>
        <button className="white-button" type="button" onClick={() => openTrace(selectedJournal.id, "erp")}>5단계 흐름 보기 →</button>
      </section>

      <nav className="erp-detail-tabs" aria-label="전표 상세 메뉴">{([ ["overview", "전표 개요"], ["sales", "포함 매출"], ["validation", "전표 검증"], ["lines", "분개 라인"], ["history", "변경 이력"] ] as const).map(([id, label]) => <button key={id} type="button" className={detailTab === id ? "active" : ""} onClick={() => setDetailTab(id)}>{label}</button>)}</nav>
      <div className={"selected-rule-grid erp-tab-panel " + (detailTab === "overview" ? "active" : "")}>
        <section className="content-card selected-rule-card">
          <div className="section-title"><div><span className="section-kicker">APPLIED RULE SNAPSHOT</span><h2>이 전표에 적용된 집계 규칙</h2></div><span className="record-status resolved">생성 당시 규칙</span></div>
          <div className="rule-key-values">
            <div><small>대상 기간</small><strong>{selectedJournal.period}</strong></div><div><small>점포</small><strong>{selectedJournal.store}</strong></div><div><small>카드사</small><strong>{selectedJournal.card}</strong></div><div><small>결제수단</small><strong>카드</strong></div><div><small>집계 주기</small><strong>{selectedJournal.cadence}</strong></div><div><small>적용 규칙</small><strong>{selectedRule.code}</strong></div>
          </div>
        </section>
        <aside className={"content-card journal-diagnosis " + (journalNeedsReview ? "error" : "normal")}><small>검증 판단</small><strong>{journalNeedsReview ? "ERP 단계 확인 필요" : selectedJournal.status === "상위 단계 확인" ? "ERP 전표 자체는 정상" : "전표·원천 일치"}</strong><p>{selectedJournal.note}</p></aside>
      </div>

      <section className={"content-card journal-breakdown erp-tab-panel " + (detailTab === "overview" || detailTab === "sales" ? "active" : "")}>
        <div className="section-title"><div><span className="section-kicker">DAILY BREAKDOWN</span><h2>전표에 포함된 일자별 매출</h2><p>집계 전표를 영업일 단위로 나눈 뒤 이상 일자를 선택합니다.</p></div><span className="status-pill blue">선택 {selectedDay.date}</span></div>
        <div className="table-scroll"><table><thead><tr><th>영업일</th><th>POS 매출 건수</th><th>POS 매출액</th><th>카드사 매입액</th><th>정산액</th><th>ERP 연결 원천</th><th>차이</th><th>판정</th></tr></thead><tbody>
          {dayRows.map((row) => <tr key={row.date} className={(selectedDay.date === row.date ? "selected-row " : "") + (row.gap > 0 ? "exception-row" : "")} onClick={() => setSelectedDate(row.date)}><td className="mono strong">{row.date}</td><td>{row.sales}건</td><td>{formatWon(row.gross)}</td><td>{formatWon(row.acquired)}</td><td>{formatWon(row.settled)}</td><td>{row.linked}건</td><td className={row.gap > 0 ? "danger-text strong" : ""}>{formatWon(row.gap)}</td><td><span className={"record-status " + (row.gap > 0 ? "error" : "resolved")}>{row.status}</span></td></tr>)}
        </tbody></table></div>
      </section>

      <section className={"content-card included-sales-card erp-tab-panel " + (detailTab === "sales" ? "active" : "")}>
        <div className="section-title"><div><span className="section-kicker">INCLUDED SALES</span><h2>{selectedDay.date} 전표 포함 매출</h2><p>{selectedJournal.store} · {selectedJournal.card} · 원천 {selectedDay.linked}건 중 일부를 표시합니다.</p></div><button className="text-button" type="button" onClick={() => downloadTransactions(scenario)}>현재 거래 CSV ↓</button></div>
        <div className="table-scroll transaction-table"><table><thead><tr><th>POS 거래번호</th><th>점포</th><th>카드사</th><th>영업일</th><th>승인일자</th><th>승인시각</th><th>승인번호</th><th>매입일자</th><th>정산일자</th><th>금액</th><th>전표 포함</th></tr></thead><tbody>
          {scenario.incidents.map((row, index) => <tr key={row.transactionId}><td className="mono strong">POS-{selectedDay.date.replace("-", "")}-{String(index + 41).padStart(4, "0")}</td><td>{selectedJournal.store}</td><td>{selectedJournal.card}</td><td>2026-{selectedDay.date}</td><td>2026-{selectedDay.date}</td><td className="mono">{row.approvedAt}</td><td className="mono">{row.approvalNo ?? "30012" + String(341 + index)}</td><td>2026-07-01</td><td>2026-07-02</td><td>{formatWon(row.amount)}</td><td><span className={"record-status " + (journalNeedsReview && index < selectedJournal.sourceGap ? "error" : "resolved")}>{journalNeedsReview && index < selectedJournal.sourceGap ? "미연결" : "포함"}</span></td></tr>)}
        </tbody></table></div>
      </section>

      <div className={"journal-validation-layout erp-tab-panel " + (detailTab === "validation" ? "active" : "")}>
        <section className="content-card journal-validation-card">
          <div className="section-title"><div><span className="section-kicker">EXPECTED VS ACTUAL</span><h2>예상 전표 대 실제 전표</h2></div><span className={"record-status " + (journalNeedsReview ? "error" : "resolved")}>{journalNeedsReview ? "원천 구성 확인" : "전표 검증 통과"}</span></div>
          <div className="validation-list"><div className="validation-row validation-head"><span>검증 항목</span><span>산출 기준</span><span>예상값</span><span>실제값</span><span>결과</span></div>
            {[
              ["총매출", "카드사 매입 확정액", formatWon(selectedJournal.gross), formatWon(selectedJournal.gross), true],
              ["카드 수수료", "정산 수수료 합계", formatWon(selectedJournal.fee), formatWon(selectedJournal.fee), true],
              ["정산 예정액", "정산시스템 집계", formatWon(selectedJournal.net), formatWon(selectedJournal.net), true],
              ["원천 거래 연결", "정산 대상 고유 거래", selectedJournal.sources + "건", actualLinked + "건", !journalNeedsReview],
              ["집계 규칙", selectedRule.code, selectedJournal.rule, selectedJournal.rule, true],
            ].map((row) => <div className={"validation-row " + (row[4] ? "" : "failed")} key={String(row[0])}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span>{row[3]}</span><i>{row[4] ? "일치" : "불일치"}</i></div>)}
          </div>
        </section>
        <aside className="content-card source-link-card">
          <div className="section-title"><div><span className="section-kicker">SOURCE COVERAGE</span><h2>원천 연결 범위</h2></div></div>
          <div className="coverage-number"><strong>{Math.round(actualLinked / selectedJournal.sources * 1000) / 10}%</strong><span>{actualLinked.toLocaleString()} / {selectedJournal.sources.toLocaleString()}건 연결</span></div>
          <div className="coverage-bar"><span style={{ width: Math.round(actualLinked / selectedJournal.sources * 1000) / 10 + "%" }} /></div>
          <div className="coverage-stats"><div><small>전표 헤더</small><strong>1건</strong></div><div><small>원천 거래</small><strong>{selectedJournal.sources.toLocaleString()}건</strong></div><div><small>미연결</small><strong className={journalNeedsReview ? "danger-text" : ""}>{selectedJournal.sourceGap}건</strong></div></div>
        </aside>
      </div>

      <section className={"content-card erp-change-history erp-tab-panel " + (detailTab === "history" ? "active" : "")}>
        <div className="section-title"><div><span className="section-kicker">JOURNAL AUDIT</span><h2>전표 변경 이력</h2></div><span className="record-status resolved">감사 기록</span></div>
        <div className="audit-timeline"><HistoryItem time="07-03 09:10" title="집계 대상 확정" detail={`${selectedJournal.period} · ${selectedJournal.sources.toLocaleString()}건`} state="done"/><HistoryItem time="07-03 09:13" title="ERP 전표 자동 생성" detail={`${selectedJournal.rule} · ${selectedJournal.id}`} state="done"/><HistoryItem time="07-03 09:18" title="원천 연결 검증" detail={selectedJournal.note} state={journalNeedsReview ? "pending" : "done"}/><HistoryItem time="-" title="회계 담당자 승인" detail="검증 완료 후 승인 예정" state="pending"/></div>
      </section>
      <section className={"content-card journal-lines-card erp-tab-panel " + (detailTab === "lines" ? "active" : "")}>
        <div className="section-title"><div><span className="section-kicker">JOURNAL LINES</span><h2>선택 전표 분개 라인</h2></div><small>실제 계정과목과 생성 방식은 회사 정책에 따라 달라집니다.</small></div>
        <div className="table-scroll"><table><thead><tr><th>라인</th><th>차/대변</th><th>계정과목</th><th>금액</th><th>적요</th><th>검증</th></tr></thead><tbody>{journalLines.map((line) => <tr key={line.no}><td>{line.no}</td><td><span className={"entry-side " + (line.side === "차변" ? "debit" : "credit")}>{line.side}</span></td><td className="strong">{line.account}</td><td>{formatWon(line.amount)}</td><td>{line.memo}</td><td><span className="record-status resolved">금액 일치</span></td></tr>)}</tbody></table></div>
      </section>
      </>}
    </div>
  );
}

function MismatchPage({ scenario }: { scenario: Scenario }) {
  const openCase = useSettlementStore((state) => state.openCase);
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
          {records.map((record, index) => <button key={record.id} type="button" className={`mismatch-row ${index === 0 ? "featured" : ""}`} onClick={() => openCase(record.traceRef, "mismatch")}>
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
      <CaseTabs active="trace" />
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
