import { withEntitlementsPlist } from '@expo/config-plugins';

// Personal Apple teams cannot provision remote push. Keep that exception
// explicit and confined to a separately identified local development app.
export default ({ config }) => {
  if (process.env.CLASSFY_IOS_PERSONAL_TEAM !== '1') return config;

  const localConfig = {
    ...config,
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
