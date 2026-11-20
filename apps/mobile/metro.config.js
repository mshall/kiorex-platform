// Everything resolves inside apps/mobile (nested install). The root workspace hoists its own React 19 (web/ops, a different patch than the Expo-pinned one),
// so hierarchical lookup is disabled to keep Metro from ever picking up the root copy.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
