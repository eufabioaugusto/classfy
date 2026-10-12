import { FileText, Pause, Play } from 'lucide-react-native';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { studioTeleprompterBlocks, studioTeleprompterLines, studioTeleprompterReadEnd, studioTeleprompterScrollTarget,
  type StudioTeleprompterBlock, type StudioTeleprompterLine, type StudioTeleprompterWord } from './StudioTeleprompterLayout';

export type StudioTeleprompterMode = 'voice' | 'automatic';
export type StudioTeleprompterProps = {
  script: string; words: readonly StudioTeleprompterWord[]; readWordCount: number; mode: StudioTeleprompterMode;
  playing: boolean; active: boolean; resetKey: string | number; speed: number;
  status: string; statusDetail?: string; playDisabled?: boolean;
  maxTextHeight: number; landscape?: boolean; style?: StyleProp<ViewStyle>;
  onPlayPause: () => void; onManualScroll: () => void; onHeight?: (height: number) => void;
};

const ScriptBlock = memo(function ScriptBlock({ block, readEnd, landscape, onMeasure, onLines }: {
  block: StudioTeleprompterBlock; readEnd: number; landscape: boolean;
  onMeasure: (block: StudioTeleprompterBlock, top: number) => void; onLines: (block: StudioTeleprompterBlock, lines: StudioTeleprompterLine[]) => void;
}) {
  return <View onLayout={event => onMeasure(block, event.nativeEvent.layout.y)}>
    <Text style={[styles.text, landscape && styles.landscapeText]} onTextLayout={event => onLines(block, studioTeleprompterLines(block, event.nativeEvent.lines))}>
      {!!readEnd && <Text style={styles.read}>{block.text.slice(0, readEnd)}</Text>}{block.text.slice(readEnd)}
    </Text>
  </View>;
});

/** UI overlays only: no script or highlight is sent to the captured media. */
export function StudioTeleprompter(props: StudioTeleprompterProps) {
  const scroll = useRef<ScrollView>(null), offset = useRef(0);
  const size = useRef({ viewport: 0, content: 0 });
  const measurements = useRef(new Map<number, { top?: number; lines?: StudioTeleprompterLine[] }>());
  const live = useRef(props); live.current = props;
  const blocks = useMemo(() => studioTeleprompterBlocks(props.script, props.words), [props.script, props.words]);
  const liveBlocks = useRef(blocks); liveBlocks.current = blocks;
  const measuredScript = useRef(props.script);
  if (measuredScript.current !== props.script) {
    // Drop the old measurements before accepting events for the new script.
    // Block identity below also rejects delayed events with the same key=0.
    measurements.current.clear(); offset.current = 0; measuredScript.current = props.script;
  }
  const measureWord = () => {
    const current = live.current;
    if (current.mode !== 'voice' || !current.playing || !current.active) return;
    const word = current.words[Math.min(current.words.length - 1, current.readWordCount)];
    if (!word) return;
    const measured = [...measurements.current.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, item]) =>
      item.top !== undefined && item.lines ? [{ top: item.top, lines: item.lines }] : []);
    const target = studioTeleprompterScrollTarget(word.start, measured, size.current.viewport, size.current.content);
    if (target !== null && Math.abs(offset.current - target) > 1) {
      offset.current = target; scroll.current?.scrollTo({ y: target, animated: true });
    }
  };
  const callbacks = useRef({
    onMeasure(block: StudioTeleprompterBlock, top: number) {
      if (!liveBlocks.current.includes(block)) return;
      measurements.current.set(block.key, { ...measurements.current.get(block.key), top }); measureWord();
    },
    onLines(block: StudioTeleprompterBlock, lines: StudioTeleprompterLine[]) {
      if (!liveBlocks.current.includes(block)) return;
      measurements.current.set(block.key, { ...measurements.current.get(block.key), lines }); measureWord();
    },
  });
  useEffect(() => { offset.current = 0; scroll.current?.scrollTo({ y: 0, animated: false }); }, [props.script]);
  useEffect(() => { offset.current = 0; scroll.current?.scrollTo({ y: 0, animated: false }); }, [props.resetKey]);
  useEffect(measureWord, [props.readWordCount, props.playing, props.active, props.mode]);
  useEffect(() => {
    if (props.mode !== 'automatic' || !props.playing || !props.active) return;
    const timer = setInterval(() => {
      const maximum = Math.max(0, size.current.content - size.current.viewport);
      offset.current = Math.min(maximum, offset.current + props.speed / 20);
      scroll.current?.scrollTo({ y: offset.current, animated: false });
    }, 50);
    return () => clearInterval(timer);
  }, [props.mode, props.playing, props.active, props.speed]);
  return <View testID="studio-teleprompter" onLayout={event => props.onHeight?.(event.nativeEvent.layout.height)} style={[styles.surface, props.style]}>
    <View style={styles.header}>
      <View style={styles.identity}><FileText color="#D9D3DC" size={13} strokeWidth={1.5} /><Text style={styles.label}>ROTEIRO</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={props.playing ? 'Pausar leitura do roteiro' : props.mode === 'voice' ? 'Ensaiar roteiro com minha voz' : 'Ativar leitura em velocidade fixa'}
        accessibilityState={{ disabled: props.playDisabled }} disabled={props.playDisabled} onPress={props.onPlayPause} hitSlop={8} style={styles.action}>
        {props.playing ? <Pause color="#FFFFFF" size={16} /> : <Play color="#FFFFFF" size={16} />}
      </Pressable>
    </View>
    <ScrollView ref={scroll} style={[styles.scroll, { maxHeight: props.maxTextHeight }]} showsVerticalScrollIndicator={false}
      onLayout={event => { size.current.viewport = event.nativeEvent.layout.height; measureWord(); }}
      onContentSizeChange={(_, height) => { size.current.content = height; measureWord(); }}
      onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} onScrollBeginDrag={props.onManualScroll}>
      {blocks.map(block => <ScriptBlock key={block.key} block={block} landscape={!!props.landscape}
        readEnd={props.mode === 'voice' ? studioTeleprompterReadEnd(block, props.words, props.readWordCount) : 0}
        onMeasure={callbacks.current.onMeasure} onLines={callbacks.current.onLines} />)}
      <View style={{ height: props.maxTextHeight - (props.landscape ? 28 : 32) }} />
    </ScrollView>
    <Text accessibilityLiveRegion="polite" accessibilityLabel={props.statusDetail || props.status} numberOfLines={2} style={styles.status}>{props.status}</Text>
  </View>;
}
const styles = StyleSheet.create({
  surface: { position: 'absolute', backgroundColor: 'rgba(8,8,10,0.82)', borderRadius: 16, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 6 }, label: { color: '#D9D3DC', fontSize: 8, letterSpacing: 1.7, fontWeight: '600' },
  action: { width: 36, height: 30, justifyContent: 'center', alignItems: 'center' }, scroll: { flexShrink: 1 },
  text: { color: '#FFFFFF', fontSize: 22, lineHeight: 32, fontWeight: '500' }, landscapeText: { fontSize: 20, lineHeight: 28 },
  read: { color: '#FB5672' }, status: { color: '#C7C0C7', fontSize: 10, lineHeight: 14, paddingTop: 5 },
});
