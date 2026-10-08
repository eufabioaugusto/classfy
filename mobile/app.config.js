import { AndroidConfig, withAndroidManifest, withEntitlementsPlist } from '@expo/config-plugins';

// Personal Apple teams cannot provision remote push. Keep that exception
// explicit and confined to a separately identified local development app.
export default ({ config }) => {
  // iOS permits landscape recording, with a portrait initial lock. Preserve
  // Android's existing portrait default until its Studio exporter is ready.
  const platformConfig = withAndroidManifest(config, (mod) => {
    AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults).$['android:screenOrientation'] = 'portrait';
    return mod;
  });
  if (process.env.CLASSFY_IOS_PERSONAL_TEAM !== '1') return platformConfig;

  const localConfig = {
    ...platformConfig,
    name: 'Classfy Dev',
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
    },
    extra: {
      ...config.extra,
      localDevelopment: { pushNotificationsEnabled: false },
    },
  };

  // Run after the notifications plugin has added the normal entitlement.
  return withEntitlementsPlist(localConfig, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
