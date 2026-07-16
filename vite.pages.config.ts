import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isAccountSite = repositoryName.endsWith(".github.io");
const base = process.env.GITHUB_ACTIONS
  ? isAccountSite
    ? "/"
    : `/${repositoryName}/`
  : "/";

export default defineConfig({
  root: "pages",
  base,
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
