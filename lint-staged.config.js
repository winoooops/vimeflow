export default {
  '*.{js,jsx,ts,tsx}': ['eslint --max-warnings=0'],
  '*.{ts,tsx}': () => 'tsc --noEmit',
  '*.{js,mjs,jsx,ts,tsx,json,css,md,yaml,yml}': ['prettier --write'],
}
