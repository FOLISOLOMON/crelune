const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch monorepo workspace root so @crelune/shared and @crelune/ui/colors resolve live
config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), monorepoRoot]));

config.resolver = config.resolver ?? {};
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;

// Defense-in-depth guardrail: prevent bundling server-only DB / Prisma / Web packages into mobile
const forbiddenPatterns = [
  /[\\/]packages[\\/]database[\\/]/,
  /[\\/]apps[\\/]web[\\/]/,
  /[\\/]apps[\\/]agent[\\/]/,
  /[\\/]node_modules[\\/]@prisma[\\/]client[\\/]/,
  /[\\/]node_modules[\\/]prisma[\\/]/,
];

const existingBlockList = config.resolver.blockList;
if (Array.isArray(existingBlockList)) {
  config.resolver.blockList = [...existingBlockList, ...forbiddenPatterns];
} else if (existingBlockList) {
  config.resolver.blockList = [existingBlockList, ...forbiddenPatterns];
} else {
  config.resolver.blockList = forbiddenPatterns;
}

module.exports = config;
