"use client";

import { useEffect, useState } from "react";
import { formatWon, getScenario, scenarios, type FlowStage, type Scenario, type StageStatus } from "./scenarios";
import { useSettlementStore, type AppView } from "./settlement-store";
import { buildMismatchRecords, buildSystemDatasets, buildTraceRows, type SystemKey } from "./system-data";

const navSections: Array<{ label: string; items: Array<{ id: AppView; label: string; icon: string; help: string }> }> = [
  { label: "오늘의 업무", items: [
    { id: "dashboard", label: "정산 업무 홈", icon: "⌂", help: "마감·예외·할 일" },
    { id: "mismatches", label: "대사 예외함", icon: "!", help: "미결·미연결 거래" },
  ] },
  { label: "조회 및 검증", items: [
    { id: "erp", label: "ERP 전표 검증", icon: "J", help: "예상 전표와 비교" },
    { id: "trace", label: "거래·전표 추적", icon: "↔", help: "원천 연결 관계" },
    { id: "systemData", label: "원천 데이터 조회", icon: "D", help: "POS·정산·입금" },
  ] },
  { label: "조사 및 처리", items: [
    { id: "investigation", label: "원인 조사 지원", icon: "AI", help: "원인 후보·담당 부서" },
    { id: "resolution", label: "업무 처리", icon: "✓", help: "배정·재처리·검증" },
    { id: "history", label: "처리·감사 이력", icon: "H", help: "조치 근거와 변경 기록" },
  ] },
];
const navItems = navSections.flatMap((section) => section.items);

const guideSteps: Array<{ view: AppView; target: string; label: string; title: string; description: string; takeaway: string }> = [
  { view: "dashboard", target: "home-kpis", label: "업무 시작", title: "오늘 확인할 정산 예외를 먼저 봅니다", description: "회계 담당자는 전체 전표를 훑는 대신 마감 진행률과 미결 예외부터 확인합니다.", takeaway: "오늘의 우선 업무는 미결 대사 예외 4건입니다." },
  { view: "dashboard", target: "flow-divergence", label: "자동 감지", title: "승인 100건 중 매입 95건만 반영됐습니다", description: "POS와 VAN까지는 정상이고 카드사 매입부터 5건이 부족합니다. 시스템은 카드사별 정상 대기시간이 지난 뒤 사건을 생성합니다.", takeaway: "최초 이상 구간은 VAN 승인 → 카드사 매입입니다." },
  { view: "mismatches", target: "exception-inbox", label: "예외 접수", title: "자동 감지된 사건이 대사 예외함에 들어옵니다", description: "전표가 없거나 아직 연결되지 않은 사건도 이 목록에서 함께 관리합니다. 담당자는 영향 금액과 마감 시각으로 우선순위를 정합니다.", takeaway: "전체 데이터가 아니라 예외 사건만 조사합니다." },
  { view: "trace", target: "transaction-trace", label: "거래 추적", title: "문제가 처음 발생한 시스템 구간을 확인합니다", description: "각 시스템의 문서번호와 연결 키를 따라 POS부터 ERP까지 전달 상태를 비교합니다.", takeaway: "ERP의 1전표·3라인은 95개 원천을 묶은 정상 집계입니다." },
  { view: "erp", target: "journal-validation", label: "전표 검증", title: "예상 전표와 실제 전표를 비교합니다", description: "매출·수수료·입금액뿐 아니라 원천 연결률과 집계 기준을 함께 검증합니다.", takeaway: "이 사례의 ERP 전표는 정상이며 문제는 ERP 이전 단계에 있습니다." },
  { view: "investigation", target: "ai-investigation", label: "AI 조사", title: "AI가 원인 후보와 확인 순서를 정리합니다", description: "AI는 원인을 단정하지 않고 거래시간, 배치 로그, 반대 근거와 추가 확인 항목을 함께 보여줍니다.", takeaway: "1순위는 VAN 매입 전송 배치의 부분 실패입니다." },
  { view: "resolution", target: "case-resolution", label: "업무 처리", title: "추천 담당자에게 근거와 함께 조사를 요청합니다", description: "담당자를 배정하고 요청문을 만든 뒤 재처리 결과를 같은 대사 규칙으로 다시 검증합니다.", takeaway: "회계 담당자는 판단과 승인에 집중합니다." },
  { view: "history", target: "audit-history", label: "감사 이력", title: "확정 원인과 조치 결과를 다음 조사에 남깁니다", description: "누가 어떤 근거로 판단하고 무엇을 변경했는지 보존해 유사 사건의 추천 품질을 높입니다.", takeaway: "자동 감지부터 정상화까지 하나의 사건 이력으로 연결됩니다." },
];

const statusLabel: Record<StageStatus, string> = {
  normal: "정상", waiting: "대기", review: "확인 필요", error: "오류",
};

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
            <div className="date-chip">정산 기준일 2026-07-15</div>
            <button className="notification-button" type="button" aria-label="알림 3건">3</button>
            <button className="avatar" type="button" aria-label="사용자 메뉴">회</button>
          </div>
        </header>

        <div className="page-body">
          {view === "guide" && <GuidePage onStart={() => setView("dashboard")} />}
          {view === "lab" && <ScenarioLab />}
          {view === "dashboard" && <Dashboard scenario={scenario} />}
          {view === "systemData" && <SystemDataPage scenario={scenario} />}
          {view === "erp" && <ErpJournalPage scenario={scenario} />}
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
    ["은행", "실제 입금을 확인", "입금액 · 입금일"], ["ERP", "회계 전표로 기록", "전표번호 · 회계일자"],
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
            <div className="hero-stat"><strong>6</strong><span>연결 시스템</span></div>
            <div className="hero-stat"><strong>3</strong><span>비교 시나리오</span></div>
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

  return (
    <div className="page-stack">
      <PageHeading eyebrow="DAILY SETTLEMENT OPERATIONS" title="오늘의 정산 업무" description="마감 진행률, 미결 예외, 담당 업무와 시스템별 처리 상태를 확인합니다."
        actions={<><span className="updated-at">마지막 갱신 11:42:08</span><button className="secondary-button" type="button">새로고침</button></>} />
      <section className="ops-kpis" data-tour="home-kpis">
        <div className="ops-kpi"><span className="kpi-icon blue">M</span><div><small>D+1 마감 진행률</small><strong>94.8%</strong><p>수집원 6개 중 5개 마감</p></div><i>정상</i></div>
        <button className="ops-kpi actionable" type="button" onClick={() => openTrace("JV-20260716-9001", "mismatch")}><span className="kpi-icon red">!</span><div><small>미결 대사 예외</small><strong>4건</strong><p>긴급 2 · 일반 2</p></div><i>확인</i></button>
        <div className="ops-kpi"><span className="kpi-icon amber">W</span><div><small>내 처리 업무</small><strong>3건</strong><p>14:00까지 1건</p></div><i>진행</i></div>
        <div className="ops-kpi"><span className="kpi-icon navy">₩</span><div><small>미확정 영향 금액</small><strong>6,250,000원</strong><p>전일 대비 18% 감소</p></div><i>집계</i></div>
      </section>
      <section className={`incident-hero ${scenario.tone}`}>
        <div className="incident-icon">!</div><div className="incident-copy"><small>INC-2026-0716-003 · 자동 감지</small><h2>{scenario.eventTitle}</h2><p>{scenario.eventSummary}</p></div>
        <div className="incident-metrics"><div><small>영향 거래</small><strong>{scenario.impactCount}건</strong></div><div><small>영향 금액</small><strong>{formatWon(scenario.impactAmount)}</strong></div><div><small>분류</small><strong>{scenario.classification}</strong></div></div>
        <button type="button" className="white-button" onClick={() => openTrace("JV-20260716-9001", "mismatch")}>전체 흐름 추적 →</button>
      </section>
      <section className="content-card flow-card" data-tour="flow-divergence">
        <div className="section-title"><div><span className="section-kicker">END-TO-END FLOW</span><h2>시스템별 처리 상태</h2></div><div className="legend"><span className="normal">정상</span><span className="waiting">대기</span><span className="review">확인 필요</span><span className="error">오류</span></div></div>
        <FlowStrip stages={scenario.flow} />
        <div className="divergence-banner"><span>최초 이상 구간</span><strong>{scenario.divergence}</strong><p>이전 단계까지는 거래 건수와 금액이 일치합니다.</p></div>
      </section>
      <div className="dashboard-bottom">
        <section className="content-card table-card">
          <div className="section-title"><div><span className="section-kicker">AFFECTED TRANSACTIONS</span><h2>영향 거래</h2></div><button className="text-button" type="button">엑셀 다운로드 준비 중</button></div>
          <TransactionTable scenario={scenario} />
        </section>
        <aside className="content-card pattern-card">
          <span className="section-kicker">PATTERN SUMMARY</span><h2>누락 거래의 공통점</h2><p>단순 합계 대신 거래 속성을 묶어 조사 범위를 좁혔습니다.</p>
          <div className="trait-list">{scenario.commonTraits.map((trait, index) => <div key={trait}><span>{index + 1}</span><strong>{trait}</strong></div>)}</div>
          <button className="secondary-button full" type="button" onClick={() => openTrace("JV-20260716-9001", "mismatch")}>통합 거래 추적 보기</button>
        </aside>
      </div>
    </div>
  );
}

function TransactionTable({ scenario }: { scenario: Scenario }) {
  return (
    <div className="table-scroll"><table><thead><tr><th>거래번호</th><th>점포</th><th>카드사</th><th>승인시각</th><th>금액</th><th>배치번호</th><th>상태</th></tr></thead>
      <tbody>{scenario.incidents.map((row) => <tr key={row.transactionId}><td className="mono strong">{row.transactionId}</td><td>{row.store}</td><td>{row.cardCompany}</td><td className="mono">{row.approvedAt}</td><td>{formatWon(row.amount)}</td><td className="mono">{row.batchId}</td><td><span className={`table-status ${scenario.tone}`}>{row.state}</span></td></tr>)}</tbody>
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
  const runReprocess = () => { startReprocess(); window.setTimeout(finishReprocess, 1000); };
  const copyMessage = async () => { await navigator.clipboard?.writeText(scenario.requestMessage); setCopied(true); window.setTimeout(() => setCopied(false), 1200); };

  if (!analyzed) return <div className="page-stack"><PageHeading eyebrow="CASE WORKFLOW" title="먼저 AI 조사를 실행해 주세요" description="조사 결과가 만들어지면 담당자 요청과 재처리 흐름을 이어갈 수 있습니다."/><section className="analysis-empty"><div className="analysis-mark">04</div><h2>AI 조사 결과가 아직 없습니다</h2><p>원인 후보와 담당자를 확인한 후 업무 처리를 시작합니다.</p><button className="primary-button" type="button" onClick={() => setView("investigation")}>AI 조사 화면으로 이동 →</button></section></div>;

  return (
    <div className="page-stack">
      <PageHeading eyebrow="CASE WORKFLOW" title="담당자 요청부터 정상화 확인까지" description="분석 결과를 실제 업무 요청으로 전환하고, 재처리 후 모든 단계를 다시 검증합니다." />
      {resolved && <section className="resolved-banner"><div className="resolved-check">✓</div><div><small>INC-2026-0716-003</small><h2>모든 단계의 정상화를 확인했습니다</h2><p>확정 원인과 처리 결과가 유사 사례 지식으로 저장됐습니다.</p></div><span>해결 완료</span></section>}
      <div className="resolution-layout" data-tour="case-resolution">
        <section className="content-card action-panel">
          <div className="section-title"><div><span className="section-kicker">ASSIGN & REQUEST</span><h2>조사 요청</h2></div><span className={`status-pill ${resolved ? "blue" : scenario.tone}`}>{resolved ? "처리 완료" : "담당자 배정"}</span></div>
          <div className="owner-box"><span className="owner-avatar large">{scenario.recommendedOwner.slice(0, 1)}</span><div><small>AI 추천 담당 영역</small><h3>{scenario.recommendedTeam}</h3><p>{scenario.recommendedOwner} · 인터페이스 운영</p></div><button type="button" className={assignedOwner ? "assigned-button" : "secondary-button"} onClick={() => assignOwner(scenario.recommendedOwner)}>{assignedOwner ? "✓ 배정 완료" : "담당자 배정"}</button></div>
          <div className="field-group"><label htmlFor="request-message">조사 요청문</label><textarea id="request-message" readOnly value={requestGenerated ? scenario.requestMessage : "AI 분석 근거를 포함한 조사 요청문을 생성할 수 있습니다."} /></div>
          <div className="button-row"><button className="primary-button" type="button" onClick={generateRequest}>요청문 생성</button><button className="secondary-button" type="button" disabled={!requestGenerated} onClick={copyMessage}>{copied ? "복사 완료" : "내용 복사"}</button></div>
          <div className="audit-note"><span>보안 안내</span> 실제 운영에서는 열람·다운로드 권한과 처리 이력을 서버에서 관리합니다.</div>
        </section>
        <section className="content-card reprocess-panel">
          <div className="section-title"><div><span className="section-kicker">REPROCESS & VERIFY</span><h2>재처리 검증</h2></div><small>{resolved ? "07-16 11:48 완료" : "처리 대기"}</small></div>
          <div className="before-after"><div className="flow-compare before"><span>처리 전</span><strong>{scenario.flow[2].count}건</strong><small>{scenario.divergence}</small></div><div className={`compare-arrow ${reprocessing ? "spinning" : ""}`}>{reprocessing ? "↻" : "→"}</div><div className={`flow-compare after ${resolved ? "complete" : ""}`}><span>재처리 후</span><strong>{resolved ? "100건" : "—"}</strong><small>{resolved ? "전체 단계 일치" : "검증 대기"}</small></div></div>
          <div className="verification-list">
            {["누락 거래 반영", "중복 전표 미발생", "건수·금액 일치", "점포별 분류 일치"].map((item) => <div key={item} className={resolved ? "complete" : ""}><span>{resolved ? "✓" : "○"}</span><strong>{item}</strong><small>{resolved ? "정상" : "대기"}</small></div>)}
          </div>
          <button type="button" className="primary-button full" disabled={reprocessing || resolved || !assignedOwner || !requestGenerated} onClick={runReprocess}>{reprocessing ? "재처리 결과를 검증하는 중..." : resolved ? "정상화 검증 완료" : "재처리 실행 및 자동 검증"}</button>
          {!assignedOwner || !requestGenerated ? <p className="helper-text">담당자를 배정하고 조사 요청문을 생성하면 재처리를 실행할 수 있습니다.</p> : null}
        </section>
      </div>
      <section className="content-card history-card">
        <div className="section-title"><div><span className="section-kicker">AUDIT TRAIL</span><h2>처리 이력</h2></div><button className="text-button" type="button">전체 이력 보기</button></div>
        <div className="history-line">
          <HistoryItem time="11:42" title="이상 징후 자동 감지" detail={`${scenario.divergence} · ${scenario.impactCount}건`} state="done" />
          <HistoryItem time="11:44" title="AI 조사 완료" detail={`1순위: ${scenario.hypotheses[0].title}`} state="done" />
          <HistoryItem time={assignedOwner ? "11:45" : "—"} title="담당자 배정" detail={assignedOwner ? `${scenario.recommendedTeam} · ${assignedOwner}` : "대기 중"} state={assignedOwner ? "done" : "pending"} />
          <HistoryItem time={resolved ? "11:48" : "—"} title="재처리 및 정상화" detail={resolved ? "전체 100건 일치" : "대기 중"} state={resolved ? "done" : "pending"} />
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
      <PageHeading eyebrow="SOURCE DATA" title="원천 데이터 조회" description="거래번호, 승인번호, 정산번호, 입금 참조와 전표번호로 운영 데이터를 조회합니다."
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
          <div className="filter-group"><label>기준일</label><button type="button">2026-07-15</button></div>
          <div className="filter-group"><label>점포</label><button type="button">전체 점포</button></div>
          <div className="data-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${active.label} 번호·연결번호 검색`} aria-label="시스템 데이터 검색" /></div>
          <button className="secondary-button" type="button">필터</button>
        </div>
        <div className="dataset-context">
          <div><small>{systemTab === "erp" ? "전표 헤더" : "처리 건수"}</small><strong>{active.totalCount.toLocaleString()}건</strong></div>
          <div><small>{systemTab === "erp" ? "선택 전표 입금예정액" : "총 금액"}</small><strong>{formatWon(active.totalAmount)}</strong></div>
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
  const erp = buildSystemDatasets(scenario).find((item) => item.key === "erp")!;
  const selectedJournal = erp.rows[0];
  const cardStage = scenario.flow.find((stage) => stage.id === "card") ?? scenario.flow[2];
  const settlementStage = scenario.flow.find((stage) => stage.id === "settlement") ?? scenario.flow[3];
  const compositionError = scenario.id === "offsetting-errors";
  const sourceCount = settlementStage.count;
  const linkedCount = Math.max(0, sourceCount - (compositionError ? 1 : 0));
  const expectedGross = cardStage.amount;
  const expectedNet = settlementStage.amount;
  const expectedFee = expectedGross - expectedNet;
  const linkRate = Math.round((linkedCount / Math.max(1, sourceCount)) * 1000) / 10;
  const journalVerdict = compositionError ? "전표 구성 오류" : "전표 자체 정상";

  const validationRows = [
    { item: "총매출", basis: "카드사 매입 확정액", expected: formatWon(expectedGross), actual: formatWon(expectedGross), pass: true },
    { item: "카드 수수료", basis: "정산 수수료 합계", expected: formatWon(expectedFee), actual: formatWon(expectedFee), pass: true },
    { item: "입금 예정액", basis: "정산 지급 예정액", expected: formatWon(expectedNet), actual: formatWon(expectedNet), pass: true },
    { item: "원천 거래 연결", basis: "정산 대상 고유 거래", expected: sourceCount + "건", actual: linkedCount + "건", pass: !compositionError },
    { item: "원천 중복", basis: "POS 거래번호 중복 검사", expected: "0건", actual: compositionError ? "1건" : "0건", pass: !compositionError },
    { item: "집계 차원", basis: "영업일·점포·카드사·배치", expected: "5개 기준", actual: "5개 기준", pass: true },
  ];

  const journalLines = [
    { no: 1, side: "차변", account: "보통예금", amount: expectedNet, memo: "카드 정산 입금 예정액" },
    { no: 2, side: "차변", account: "지급수수료", amount: expectedFee, memo: "카드사 수수료" },
    { no: 3, side: "대변", account: "카드미수금", amount: expectedGross, memo: "매입 확정 카드매출 대체" },
  ];

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ERP JOURNAL CONTROL" title="ERP 전표 검증" description="정산 원천을 회계 집계 규칙으로 계산한 예상 전표와 실제 생성된 전표를 비교합니다."
        actions={<><button className="secondary-button" type="button">집계 규칙 조회</button><button className="primary-button small" type="button">전표 재검증</button></>} />

      <section className="journal-kpis">
        <div className="content-card"><small>선택 전표 헤더</small><strong>1건</strong><span>{String(selectedJournal.values[0])}</span></div>
        <div className="content-card"><small>전표 라인</small><strong>3개</strong><span>차변 2 · 대변 1</span></div>
        <div className={"content-card " + (compositionError ? "alert" : "")}><small>연결 원천 거래</small><strong>{linkedCount}/{sourceCount}건</strong><span>연결률 {linkRate}%</span></div>
        <div className={"content-card " + (compositionError ? "alert" : "")}><small>전표 검증 결과</small><strong>{journalVerdict}</strong><span>{compositionError ? "금액 일치 · 구성 불일치" : "예상 전표와 일치"}</span></div>
      </section>

      <section className={"journal-focus " + (compositionError ? "red" : "blue")}>
        <div><span className="section-kicker">SELECTED JOURNAL</span><h2>{String(selectedJournal.values[0])} · 강남점 신한카드 일마감</h2><p>영업일 2026-07-15 · 회계일 2026-07-16 · 정산배치 SETTLE-0715-03</p></div>
        <div className="reverse-route"><span>전표 1건</span><i>←</i><span>정산 원천 {sourceCount}건</span><i>←</i><span>카드 매입</span></div>
        <button className="white-button" type="button" onClick={() => openTrace(String(selectedJournal.values[0]), "erp")}>원천 거래 보기 →</button>
      </section>

      <div className="journal-validation-layout" data-tour="journal-validation">
        <section className="content-card journal-validation-card">
          <div className="section-title"><div><span className="section-kicker">EXPECTED VS ACTUAL</span><h2>예상 전표 대 실제 전표</h2></div><span className={"record-status " + (compositionError ? "error" : "resolved")}>{journalVerdict}</span></div>
          <div className="validation-list">
            <div className="validation-row validation-head"><span>검증 항목</span><span>산출 기준</span><span>예상값</span><span>실제값</span><span>결과</span></div>
            {validationRows.map((row) => <div className={"validation-row " + (row.pass ? "" : "failed")} key={row.item}>
              <strong>{row.item}</strong><span>{row.basis}</span><span>{row.expected}</span><span>{row.actual}</span><i>{row.pass ? "일치" : "불일치"}</i>
            </div>)}
          </div>
        </section>

        <aside className="content-card source-link-card">
          <div className="section-title"><div><span className="section-kicker">SOURCE COVERAGE</span><h2>원천 연결 범위</h2></div></div>
          <div className="coverage-number"><strong>{linkRate}%</strong><span>{linkedCount} / {sourceCount}건 연결</span></div>
          <div className="coverage-bar"><span style={{ width: linkRate + "%" }} /></div>
          <div className="coverage-stats">
            <div><small>정산 배치</small><strong>1개</strong></div>
            <div><small>고유 원천</small><strong>{sourceCount}건</strong></div>
            <div><small>중복 원천</small><strong className={compositionError ? "danger-text" : ""}>{compositionError ? 1 : 0}건</strong></div>
          </div>
          <div className="aggregation-rule">
            <small>전표 집계 기준</small>
            <div><span>영업일</span><span>점포</span><span>카드사</span><span>결제수단</span><span>정산배치</span></div>
          </div>
          <div className={"journal-diagnosis " + (compositionError ? "error" : "normal")}>
            <strong>{compositionError ? "ERP 단계 확인 필요" : "ERP 이전 단계 확인 필요"}</strong>
            <p>{compositionError
              ? "전표 총액은 맞지만 원천 1건이 누락되고 다른 1건이 중복 연결됐습니다."
              : "ERP는 전달받은 정산 원천을 정확히 전표화했습니다. 현재 차이는 " + scenario.divergence + "에서 시작됐습니다."}</p>
          </div>
        </aside>
      </div>

      <section className="content-card journal-lines-card">
        <div className="section-title"><div><span className="section-kicker">JOURNAL LINES</span><h2>실제 분개 라인</h2></div><small>차변 합계와 대변 합계가 일치합니다.</small></div>
        <div className="table-scroll"><table><thead><tr><th>라인</th><th>차/대변</th><th>계정과목</th><th>금액</th><th>적요</th><th>검증</th></tr></thead><tbody>
          {journalLines.map((line) => <tr key={line.no}><td>{line.no}</td><td><span className={"entry-side " + (line.side === "차변" ? "debit" : "credit")}>{line.side}</span></td><td className="strong">{line.account}</td><td>{formatWon(line.amount)}</td><td>{line.memo}</td><td><span className="record-status resolved">금액 일치</span></td></tr>)}
        </tbody></table></div>
      </section>

      <section className="content-card journal-table-card">
        <div className="section-title"><div><span className="section-kicker">JOURNAL LIST</span><h2>전표 목록</h2></div><div className="journal-filters"><button type="button">전체 점포</button><button type="button">전체 검증 결과</button><button type="button">회계일 2026-07-16</button></div></div>
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
      <PageHeading eyebrow="UNMATCHED & EXCEPTIONS" title="전표가 없거나 연결되지 않은 건도 찾습니다" description="ERP 전표에서 시작할 수 없는 사건은 정산·입금 데이터에서 정방향으로 추적합니다." />
      <section className="exception-stats">
        <div><span className="red">!</span><small>확인 필요</small><strong>2건</strong></div><div><span className="amber">◷</span><small>정상 지연</small><strong>1건</strong></div><div><span className="blue">↻</span><small>처리 중</small><strong>1건</strong></div><div><span className="navy">Σ</span><small>영향 금액</small><strong>{formatWon(records.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
      </section>
      <section className="content-card mismatch-card" data-tour="exception-inbox">
        <div className="data-toolbar mismatch-toolbar"><div className="filter-group"><label>기간</label><button type="button">07-15 ~ 07-16</button></div><div className="filter-group"><label>유형</label><button type="button">전체 오류</button></div><div className="filter-group"><label>처리 상태</label><button type="button">전체 상태</button></div><div className="data-search"><span>⌕</span><input placeholder="사건번호·거래번호 검색" aria-label="불일치 검색" /></div></div>
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
        <div><small>회계일자</small><strong>2026-07-16</strong><span>정산 기준일 07-15</span></div>
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
    ["CASE-2026-0712-007", "은행 분할 입금의 정상 시차", "자금 운영팀", "정상 종결", "07-12 10:05", 3],
    ["CASE-2026-0709-021", "취소 전문 재전송 실패", "VAN 인터페이스팀", "해결 완료", "07-09 14:28", 2],
  ];
  return (
    <div className="page-stack">
      <PageHeading eyebrow="CASE KNOWLEDGE & AUDIT" title="처리 이력과 확정 원인을 다음 조사에 활용합니다" description="누가 어떤 근거로 판단하고 무엇을 변경했는지 감사 가능한 형태로 보존합니다." />
      <section className="knowledge-kpis"><div><small>누적 사건</small><strong>128건</strong><span>최근 90일</span></div><div><small>평균 조사시간</small><strong>18분</strong><span>기존 74분 대비 감소</span></div><div><small>AI Top 3 포함</small><strong>87%</strong><span>확정 원인 기준</span></div><div><small>정상 지연 분류</small><strong>34건</strong><span>불필요 문의 방지</span></div></section>
      <section className="content-card case-history-card" data-tour="audit-history">
        <div className="section-title"><div><span className="section-kicker">RESOLVED CASES</span><h2>과거 사건과 유사 사례</h2></div><div className="journal-filters"><button type="button">전체 원인</button><button type="button">전체 담당팀</button><button type="button">최근 90일</button></div></div>
        <div className="table-scroll"><table><thead><tr><th>사건번호</th><th>확정 원인</th><th>처리 담당</th><th>상태</th><th>발생일시</th><th>영향 건수</th><th>상세</th></tr></thead><tbody>
          {cases.map((item) => <tr key={String(item[0])}><td className="mono strong">{item[0]}</td><td>{item[1]}</td><td>{item[2]}</td><td><span className={`record-status ${item[3] === "처리 중" ? "progress" : "resolved"}`}>{item[3]}</span></td><td>{item[4]}</td><td>{item[5]}건</td><td><button type="button" className="row-link" onClick={() => openTrace("JV-20260716-9001", "mismatch")}>흐름 보기 →</button></td></tr>)}
        </tbody></table></div>
      </section>
      <section className="content-card audit-log-card"><div className="section-title"><div><span className="section-kicker">AUDIT LOG</span><h2>현재 사건 변경 이력</h2></div><span className="status-pill blue">삭제 불가 기록</span></div>
        <div className="audit-timeline"><HistoryItem time="11:42" title="이상 징후 자동 감지" detail={`${scenario.divergence} · ${scenario.impactCount}건`} state="done"/><HistoryItem time="11:44" title="AI 조사 실행" detail={`원인 후보 ${scenario.hypotheses.length}개 생성`} state="done"/><HistoryItem time="11:45" title="담당자 배정" detail={`${scenario.recommendedTeam} · ${scenario.recommendedOwner}`} state="done"/><HistoryItem time={resolved ? "11:48" : "—"} title="재처리 결과" detail={resolved ? "100건 정상화 확인" : "처리 대기"} state={resolved ? "done" : "pending"}/></div>
      </section>
    </div>
  );
}
