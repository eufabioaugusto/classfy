// Register WebRTC before Expo Router loads any LiveKit consumers. New JS also
// runs in older development clients: the gate must precede every SDK require.
const { initializeNativeLiveSDK } = require('./src/features/live/transport');
initializeNativeLiveSDK();
require('expo-router/entry');
