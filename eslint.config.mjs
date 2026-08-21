import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import playwright from "eslint-plugin-playwright";
import promise from "eslint-plugin-promise";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "coverage/**", "node_modules/**", "playwright-report/**", "spike/**", "test-results/**"]),
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    extends: [tseslint.configs.recommended, promise.configs["flat/recommended"]],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    files: ["e2e/**/*.ts"],
    extends: [playwright.configs["flat/recommended"]],
  },
]);
