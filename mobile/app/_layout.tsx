import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { MobileMiniPlayer } from '@/components/MobileMiniPlayer';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { useAuth } from '@/features/auth/authContext';
import { MiniPlayerProvider } from '@/features/watch/MiniPlayerProvider';
import { colors } from '@/theme/tokens';
import { initMobileMediaMonitor } from '@/lib/mediaMonitor';

// Initialize dev-only media monitor
initMobileMediaMonitor();

function AppSplashWrapper({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [iconSymbol, setIconSymbol] = useState<'play' | 'layers' | 'c'>('play');

  // Animation values
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0)).current;

  // Morph Symbol Motion Blur & Opacity
  const symbolOpacity = useRef(new Animated.Value(0)).current;
  const symbolTranslateY = useRef(new Animated.Value(0)).current;

  // Text brand expansion (pushing C to left)
  const lassfyWidth = useRef(new Animated.Value(0)).current;
  const lassfyOpacity = useRef(new Animated.Value(0)).current;

  // Intelligence Pulse Rings
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  // Progress Track & Spark
  const loaderOpacity = useRef(new Animated.Value(0)).current;
  const progressLine = useRef(new Animated.Value(0)).current;
  const progressSpark = useRef(new Animated.Value(0)).current;

  // Root screen reveal scale/opacity simulation
  const revealScale = useRef(new Animated.Value(0.96)).current;
  const revealOpacity = useRef(new Animated.Value(0)).current;

  // Helper to transition symbol with directional motion blur
  const transitionSymbol = (nextSymbol: 'play' | 'layers' | 'c') => {
    Animated.parallel([
      Animated.timing(symbolOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(symbolTranslateY, {
        toValue: -15,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIconSymbol(nextSymbol);
      symbolTranslateY.setValue(15);

      Animated.parallel([
        Animated.timing(symbolOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(symbolTranslateY, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  useEffect(() => {
    // Stage 1: Entrance Glow (0.0s - 0.16s)
    Animated.timing(glowOpacity, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Stage 2: Logo birth (0.24s)
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(iconScale, {
          toValue: 1,
          duration: 360,
          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
          useNativeDriver: true,
        }),
        Animated.timing(symbolOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
    }, 240);

    // Stage 2.1: Morph symbol: Play -> Layers (0.64s)
    setTimeout(() => {
      transitionSymbol('layers');
    }, 640);

    // Stage 2.2: Morph symbol: Layers -> C (1.04s)
    setTimeout(() => {
      transitionSymbol('c');
    }, 1040);

    // Stage 2.3: Reveal Text - C pushed left, "lassfy" slides open (1.4s)
    // Target width adjusted to 106 per user specification
    setTimeout(() => {
      Animated.timing(lassfyWidth, {
        toValue: 106, 
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();

      Animated.timing(lassfyOpacity, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }, 1400);

    // Stage 3: Pulse Ring triggers (1.76s)
    setTimeout(() => {
      ringScale.setValue(1);
      ringOpacity.setValue(0.35);
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 2.2,
          duration: 560,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 560,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }, 1760);

    // Stage 4: Progress line fades in and then expands underneath (1.88s - 2.5s)
    setTimeout(() => {
      Animated.timing(loaderOpacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: false,
      }).start(() => {
        Animated.parallel([
          Animated.timing(progressLine, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(progressSpark, {
            toValue: 1,
            duration: 640,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }),
        ]).start();
      });
    }, 1880);
  }, []);

  // Dismiss splash when loading is false & transition completes
  useEffect(() => {
    if (!loading) {
      Animated.sequence([
        Animated.delay(2680),
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(revealOpacity, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(revealScale, {
            toValue: 1,
            duration: 350,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setShowSplash(false);
      });
    }
  }, [loading]);

  const progressLineWidth = progressLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 140],
  });

  const progressSparkPosition = progressSpark.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 136],
  });

  const renderInnerSymbol = () => {
    switch (iconSymbol) {
      case 'play':
        return <Ionicons name="play" size={44} color="#FFFFFF" style={{ marginLeft: 6 }} />;
      case 'layers':
        return <Ionicons name="layers" size={42} color="#FFFFFF" />;
      case 'c':
        return null;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {/* Root Layout Wrapper */}
      <Animated.View style={{ flex: 1, opacity: showSplash ? revealOpacity : 1, transform: [{ scale: showSplash ? revealScale : 1 }] }}>
        {children}
      </Animated.View>

      {showSplash && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: '#000000',
              opacity: fadeAnim,
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 99999,
            },
          ]}
        >
          {/* Subtle Diffused Glow */}
          <Animated.View
            style={[
              styles.glow,
              {
                opacity: glowOpacity,
              },
            ]}
          />

          <View style={styles.contentContainer}>
            <View style={styles.centerContainer}>
              {/* Intelligence pulse ring */}
              <Animated.View
                style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: ringScale }],
                    opacity: ringOpacity,
                  },
                ]}
              />

              {/* Step 1 & 2: Morphing Icon Container */}
              {iconSymbol !== 'c' ? (
                <Animated.View
                  style={{
                    transform: [{ scale: iconScale }],
                    opacity: symbolOpacity,
                    width: 76,
                    height: 76,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {renderInnerSymbol()}
                </Animated.View>
              ) : (
                /* Step 3: Sibling Text components for perfect baseline alignment */
                <View style={styles.brandRow}>
                  <Text style={styles.brandLetterC}>C</Text>
                  <Animated.Text
                    numberOfLines={1}
                    ellipsizeMode="clip"
                    style={[
                      styles.brandTextRemainder,
                      {
                        width: lassfyWidth,
                        opacity: lassfyOpacity,
                        overflow: 'hidden',
                      },
                    ]}
                  >
                    lassfy
                  </Animated.Text>
                </View>
              )}
            </View>

            {/* Progress line with traveling neon spark - Fades in AFTER text is complete */}
            <Animated.View style={[styles.loaderTrack, { opacity: loaderOpacity }]}>
              {/* Thick soft bloom backdrop layer for neon glow effect */}
              <Animated.View style={[styles.loaderBarGlow, { width: progressLineWidth }]} />

              {/* Solid foreground line */}
              <Animated.View style={[styles.loaderBar, { width: progressLineWidth }]} />

              {/* Glowing traveling spark */}
              <Animated.View style={[styles.loaderSpark, { left: progressSparkPosition }]} />
            </Animated.View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { GlobalNotificationToastListener } from '@/components/GlobalNotificationToastListener';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Listener for when a notification is tapped/interacted with by the user
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Push notification tapped by user:', response);
      // Route user directly to the notifications screen
      router.push('/notifications');
    });

    return () => {
      responseSubscription.remove();
    };
  }, [router]);

  return (
    <AuthProvider>
      <AppSplashWrapper>
        <MiniPlayerProvider>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen
                name="watch/[id]"
                options={{
                  animation: 'fade',
                  contentStyle: { backgroundColor: 'transparent' },
                  presentation: 'transparentModal',
                }}
              />
            </Stack>
            <MobileMiniPlayer />
            <GlobalNotificationToastListener />
          </View>
        </MiniPlayerProvider>
      </AppSplashWrapper>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'transparent',
    shadowColor: '#e21d48',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 120,
    shadowOpacity: 0.9,
    elevation: 10,
  },
  contentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  centerContainer: {
    width: 220,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 1.5,
    borderColor: '#e21d48',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  brandLetterC: {
    color: '#FAFAFA',
    fontSize: 48,
    fontWeight: 'bold',
    fontFamily: 'System',
    letterSpacing: -0.5,
  },
  brandTextRemainder: {
    color: '#FAFAFA',
    fontSize: 48,
    fontWeight: 'bold',
    fontFamily: 'System',
    letterSpacing: -0.5,
  },
  loaderTrack: {
    width: 140,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    marginTop: 2,
    overflow: 'visible',
    position: 'relative',
  },
  loaderBarGlow: {
    height: 7, // Thicker bar behind progress to simulate neon glow / bloom
    backgroundColor: 'rgba(226, 29, 72, 0.38)',
    borderRadius: 4,
    position: 'absolute',
    left: 0,
    top: -2,
    shadowColor: '#e21d48',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  loaderBar: {
    height: '100%',
    backgroundColor: '#e21d48',
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: 0,
    shadowColor: '#e21d48',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 6,
    elevation: 4,
  },
  loaderSpark: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    top: -1.5,
    shadowColor: '#e21d48',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10, // Higher shadow radius for a bright neon bloom around the spark
    elevation: 3,
  },
});
