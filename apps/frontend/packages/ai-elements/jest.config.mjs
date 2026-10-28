export default {
  clearMocks: true,
  moduleNameMapper: {
    "^@repo/design-system/shadcn/(.*)$": "<rootDir>/../design-system/src/shadcn/$1.tsx",
    "^@repo/shared$": "<rootDir>/../shared/src/index.ts",
    "\\.css$": "<rootDir>/test/style-mock.cjs",
  },
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
        module: { type: "commonjs" },
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!\\.pnpm/(?:@shadcn\\+react|cn)@|@shadcn/react/|cn/)"],
};
