import type { Metadata } from "next";
import { SettlementApp } from "./SettlementApp";

export const metadata: Metadata = {
  title: "FlowScope AI | 정산 조사 플랫폼",
  description: "POS부터 ERP까지 정산 이상 징후를 추적하고 조사 우선순위를 제안하는 프론트 프로토타입",
};

export default function Home() {
  return <SettlementApp />;
}
