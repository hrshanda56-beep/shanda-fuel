import nextVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [...nextVitals, { ignores: ['.next-playwright/**'] }];

export default eslintConfig;
