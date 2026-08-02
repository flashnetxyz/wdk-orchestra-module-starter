const { withPodfile } = require('@expo/config-plugins');

/**
 * Enables `use_modular_headers!` in the generated iOS Podfile.
 *
 * The Spark wallet module pulls in gRPC-Swift and the SwiftNIO family. Those are
 * Swift pods that depend on C targets (CNIOAtomics, CNIODarwin, CGRPCZlib, …)
 * which don't define modules, so CocoaPods refuses to integrate them as static
 * libraries:
 *
 *   [!] The following Swift pods cannot yet be integrated as static libraries
 *
 * CocoaPods' own suggested fix is `use_modular_headers!`, which generates the
 * module maps those C targets are missing. Preferred over flipping the whole
 * build to `use_frameworks!`, which changes linkage for every pod in the app.
 *
 * Applied as a config plugin because `expo prebuild` regenerates the Podfile.
 */
const withIosModularHeaders = (config) =>
  withPodfile(config, (modConfig) => {
    const { contents } = modConfig.modResults;

    if (contents.includes('use_modular_headers!')) {
      return modConfig;
    }

    // Insert just before the first target block so it applies globally.
    const anchor = contents.indexOf('prepare_react_native_project!');
    if (anchor === -1) {
      throw new Error(
        'withIosModularHeaders: could not find prepare_react_native_project! in the Podfile'
      );
    }

    const insertAt = contents.indexOf('\n', anchor) + 1;
    modConfig.modResults.contents =
      contents.slice(0, insertAt) + '\nuse_modular_headers!\n' + contents.slice(insertAt);

    return modConfig;
  });

module.exports = withIosModularHeaders;
