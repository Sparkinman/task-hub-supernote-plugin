module.exports = {
  preset: 'react-native',
  // sn-plugin-lib ships untranspiled ESM, and the react-native preset's default
  // transformIgnorePatterns does not cover it — without this, importing anything
  // that reaches the SDK fails with "Cannot use import statement outside a module".
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|sn-plugin-lib)/)',
  ],
};
