import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"adapters/database/prisma": "src/adapters/database/prisma.ts",
		"adapters/workflow/inngest": "src/adapters/workflow/inngest.ts",
		"api/index": "src/api/index.ts",
		"channels/index": "src/channels/index.ts",
		"channels/email/index": "src/channels/email/index.ts",
		"templates/index": "src/templates/index.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	splitting: true,
	outExtension: () => ({ js: ".mjs", dts: ".d.mts" }),
});
