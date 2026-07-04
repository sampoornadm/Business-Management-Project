import { FlatCompat } from "@eslint/eslintrc";

import { baseConfig } from "./base.js";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

// next/core-web-vitals (via FlatCompat) sets its own `languageOptions.parser`
// with no `files` restriction, which would otherwise clobber the
// typescript-eslint parser for every file, including .ts/.tsx. Applying our
// base config AFTER it means ours wins the last-writer-wins merge.
/** @type {import("eslint").Linter.Config[]} */
export const nextjsConfig = [...compat.extends("next/core-web-vitals"), ...baseConfig];

export default nextjsConfig;
