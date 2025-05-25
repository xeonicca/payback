import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'node/prefer-global/process': 'off',
    'vue/component-name-in-template-casing': ['error', 'kebab-case'],
  },
})
