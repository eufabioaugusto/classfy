import { useSyncExternalStore } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { getNativeLiveRTCView, type NativeLiveTransport } from './transport';

export type NativeLivePreviewProps = {
  transport: NativeLiveTransport;
  style?: StyleProp<ViewStyle>;
  objectFit?: 'contain' | 'cover';
  mirror?: boolean;
};

/** Rendering subscribes to the private local track; it never prepares or publishes. */
export function NativeLivePreview({ transport, style, objectFit = 'contain', mirror }: NativeLivePreviewProps) {
  const snapshot = useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getSnapshot);
  const RTCView = getNativeLiveRTCView();
  return (
    <View style={[styles.container, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {RTCView && snapshot.cameraEnabled && snapshot.streamURL ? (
        <RTCView style={StyleSheet.absoluteFillObject} streamURL={snapshot.streamURL} objectFit={objectFit}
          mirror={mirror ?? snapshot.facing === 'front'} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ container: { backgroundColor: '#000', overflow: 'hidden' } });
