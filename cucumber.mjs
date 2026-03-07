export default {
	requireModule: ["tsx"],
	require: ["packages/core/features/step-definitions/**/*.ts", "packages/core/features/support/**/*.ts"],
	paths: ["packages/core/features/**/*.feature"],
	format: ["progress-bar", "html:cucumber-report.html"],
};
