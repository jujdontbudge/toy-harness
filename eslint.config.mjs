import tseslint from "typescript-eslint";

const toyPolicy = {
  rules: {
    "no-unchecked-casts": {
      meta: {
        type: "problem",
        docs: { description: "disallow unchecked TypeScript casts and non-null assertions" },
        schema: [],
        messages: { cast: "Use a type-safe contract instead of an unchecked assertion." }
      },
      create(context) {
        return {
          TSAsExpression(node) {
            const isConstAssertion = node.typeAnnotation.type === "TSConstKeyword"
              || (node.typeAnnotation.type === "TSTypeReference"
                && node.typeAnnotation.typeName.type === "Identifier"
                && node.typeAnnotation.typeName.name === "const");
            if (!isConstAssertion) {
              context.report({ node, messageId: "cast" });
            }
          },
          TSTypeAssertion(node) {
            context.report({ node, messageId: "cast" });
          },
          TSNonNullExpression(node) {
            context.report({ node, messageId: "cast" });
          }
        };
      }
    }
  }
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "node_modules/**", ".venv/**", "build/**"]
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.mjs"] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { toy: toyPolicy },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
      "@typescript-eslint/no-misused-promises": "error",
      "toy/no-unchecked-casts": "error"
    }
  },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.mjs"] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "no-eval": "error"
    }
  }
);
