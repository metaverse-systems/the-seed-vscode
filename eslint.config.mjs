import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts", "**/*.tsx"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, {
    files: ["src/**/*.ts", "src/**/*.tsx"],

    rules: {
        "@typescript-eslint/no-restricted-imports": ["error", {
            patterns: [{
                group: ["@metaverse-systems/the-seed", "@metaverse-systems/the-seed/*"],
                allowTypeImports: true,
                message: "Load the tool through src/tool (the user's installation); import only types from the package.",
            }],
        }],
    },
}];