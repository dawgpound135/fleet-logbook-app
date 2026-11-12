import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier/flat'

export default [
    { ignores: ['**/dist/**', '**/coverage/**'] },

    js.configs.recommended,

    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },

    prettier,
]
