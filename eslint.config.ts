import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import functional from "eslint-plugin-functional";

export default defineConfig(
  functional.configs.lite,
  {
    ignores: [".**/**", "dist/**"],
  },
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      functional,
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "func-style": ["error", "expression"],
      "prefer-const": "error",
      "functional/immutable-data": [
        "error",
        {
          ignoreImmediateMutation: true,
          ignoreClasses: true,
          // Declares team intent: Map/Set in-place mutation methods are an
          // exempt category. Note: the rule's accessor-pattern matching is
          // inconsistent in practice — `Map.set` always fires regardless, and
          // `Set.add` fires when the receiver is a direct `new Set<T>()`
          // identifier (but not when it comes through `??` narrowing). See
          // src/helpers/async.ts:8 for the canonical per-line-disable shape.
          ignoreAccessorPattern: ["**.set", "**.delete", "**.clear", "**.add"],
        },
      ],
      "functional/no-return-void": "off",
      "functional/no-throw-statements": "off",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "functional/immutable-data": "off",
    },
  },
  eslintConfigPrettier,
);
