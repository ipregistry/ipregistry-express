import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['dist/', 'examples/', 'coverage/'] },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    prettier,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            // Express error handlers must keep the 4-argument signature to
            // be recognized; unused parameters are underscore-prefixed.
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
)
