import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	splitting: false,
	external: ["react", "react-dom", "@react-email/render", "heraldjs"],
	outExtension: () => ({ js: ".mjs" }),
});
