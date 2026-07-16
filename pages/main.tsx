import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettlementApp } from "../app/SettlementApp";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettlementApp />
  </StrictMode>,
);
