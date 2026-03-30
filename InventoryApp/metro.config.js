const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle .wasm files required by expo-sqlite on web
config.resolver.assetExts.push('wasm');

module.exports = config;
