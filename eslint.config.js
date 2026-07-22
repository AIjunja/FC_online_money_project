import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "dist-types", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { globals: { ...globals.browser, ...globals.node } }, plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh }, rules: { "react-refresh/only-export-components": "warn", "react-hooks/exhaustive-deps": "warn" } },
);
