import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock, SkeletonGroup } from './LoadingPlaceholder';

// For thumbnails that fill a clipped parent. Data and image decoding have separate loading states.
export function LoadingImage(props: ImageProps) {
  const [loading, setLoading] = useState(true);
  return <>
    <Image {...props}
      onLoadStart={() => { setLoading(true); props.onLoadStart?.(); }}
      onDisplay={() => { setLoading(false); props.onDisplay?.(); }}
      onError={event => { setLoading(false); props.onError?.(event); }} />
    {loading && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFillObject}>
      <SkeletonGroup style={{ flex: 1 }}><SkeletonBlock style={{ flex: 1, borderRadius: 0 }} /></SkeletonGroup>
    </View>}
  </>;
}
