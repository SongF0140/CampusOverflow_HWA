// ESLint 9 flat config：eslint-config-next 16 原生导出 flat config，直接复用（宪法 C-02）
import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "coverage/**"] },
  ...next,
  ...nextCoreWebVitals,
];

export default eslintConfig;
