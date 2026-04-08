const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle .wasm files required by expo-sqlite on web
config.resolver.assetExts.push('wasm');

// Ensure Metro resolves .web.js files for web platform
if (!config.resolver.platforms) config.resolver.platforms = [];
if (!config.resolver.platforms.includes('web')) {
  config.resolver.platforms.push('web');
}

module.exports = config;
