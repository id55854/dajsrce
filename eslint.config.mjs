import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      "node_modules/**",
      "mock-reports/**",
      "coverage/**",
      "*.tmp",
      "~$*",
      ".~lock.*",
      "next-env.d.ts",
      // Claude Code agent worktrees are full checkouts nested in the repo.
      ".claude/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
