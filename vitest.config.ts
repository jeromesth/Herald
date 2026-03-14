import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["packages/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "json-summary", "html"],
			include: ["packages/*/src/**/*.ts"],
			exclude: [
				"**/*.test.ts",
				"**/*.d.ts",
				"**/types/**",
				"**/src/index.ts",
				"**/channels/index.ts",
				"**/channels/email/index.ts",
				"**/adapters/memory.ts",
				"**/adapters/database/drizzle/index.ts",
				"**/api/index.ts",
				"**/templates/types.ts",
			],
			thresholds: {
				lines: 80,
				branches: 80,
				functions: 80,
			},
		},
	},
});
