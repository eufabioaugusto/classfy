const { withPodfile } = require('@expo/config-plugins');

// fmt 11.0.2 shipped with RN 0.81 does not allow overriding its consteval
// detection and fails on Apple Clang 21. Keep the workaround reproducible
// across Expo prebuilds, restricted to that exact vendored version.
// https://github.com/expo/expo/issues/44229
module.exports = config => withPodfile(config, mod => {
  const marker = '# Classfy: fmt 11.0.2 / Apple Clang 21 compatibility';
  if (mod.modResults.contents.includes(marker)) return mod;
  const anchor = /^([ \t]*post_install do \|installer\|)[ \t]*$/m;
  if (!anchor.test(mod.modResults.contents)) throw new Error('Não foi possível localizar post_install para compatibilidade do fmt.');
  const patch = `
    ${marker}
    fmt_base = File.join(installer.sandbox.pod_dir('fmt'), 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      fmt_source = File.read(fmt_base)
      if fmt_source.match?(/^#\\s*define FMT_VERSION 110002\\s*$/)
        fmt_patched = fmt_source.gsub(/^#\\s*define FMT_USE_CONSTEVAL 1\\s*$/, '# define FMT_USE_CONSTEVAL 0')
        if fmt_patched != fmt_source
          fmt_mode = File.stat(fmt_base).mode & 0777
          begin
            File.chmod(fmt_mode | 0200, fmt_base)
            File.write(fmt_base, fmt_patched)
          ensure
            File.chmod(fmt_mode, fmt_base)
          end
        end
      end
    end
`;
  mod.modResults.contents = mod.modResults.contents.replace(anchor, `$1\n${patch}`);
  return mod;
});
