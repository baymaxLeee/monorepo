const rspackConsumers = new Set([
  "@module-federation/enhanced",
  "@tailwindcss/webpack",
  "css-loader",
  "less-loader",
  "style-loader",
]);

export const hooks = {
  readPackage(pkg) {
    if (rspackConsumers.has(pkg.name)) {
      // Rspack supplies the bundler/loader API. Remove metadata too, otherwise
      // pnpm normalizes the orphan optional peer back into a wildcard peer.
      delete pkg.peerDependencies?.webpack;
      delete pkg.peerDependenciesMeta?.webpack;
    }
    return pkg;
  },
};
