export default {
  clearMocks: true,
  moduleNameMapper: {
    "^@repo/design-system$": "<rootDir>/../design-system/src/shadcn/questionnaire.tsx",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
        },
        module: { type: "commonjs" },
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!\\.pnpm/@shadcn\\+react@|@shadcn/react/)"],
};
