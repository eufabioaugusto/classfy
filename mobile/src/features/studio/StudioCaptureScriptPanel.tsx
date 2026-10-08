import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Check } from 'lucide-react-native';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { mutateStudioProject } from './store';
import type { StudioProject } from './model';
import { StudioButton, StudioField, studioStyles } from './StudioUI';

export function StudioCaptureScriptPanel({ project, onApplied, disabled = false }: {
  project: StudioProject; onApplied?: (project: StudioProject) => void; disabled?: boolean;
}) {
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const [script, setScript] = useState(project.script);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const context = useRef({ owner: user?.id, project, disabled });
  context.current = { owner: user?.id, project, disabled };
  useEffect(() => { if (!dirty.current) setScript(project.script); }, [project.script]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const apply = async () => {
    const current = context.current;
    if (writing.current || current.disabled || current.owner !== current.project.ownerId) return;
    const owner = current.project.ownerId;
    const id = current.project.id;
    writing.current = true; setBusy(true); Keyboard.dismiss();
    try {
      const saved = await mutateStudioProject(owner, id, latest => {
        if (context.current.owner !== owner || context.current.project.id !== id || context.current.disabled) throw new Error('Abra o roteiro na conta que está gravando este projeto.');
        if (['preparing', 'uploading', 'processing', 'submitted'].includes(latest.state)) throw new Error('Finalize o envio antes de editar o roteiro.');
        return { script: script.trim() };
      });
      dirty.current = false;
      if (mounted.current && context.current.owner === owner) onApplied?.(saved);
    } catch (error) {
      if (mounted.current && context.current.owner === owner) Alert.alert('Seu roteiro', error instanceof Error ? error.message : 'Não foi possível aplicar o roteiro. Tente novamente.');
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  return <View style={styles.panel}>
    <StudioField label="Seu guia de gravação" value={script} onChangeText={value => { dirty.current = true; setScript(value); }}
      placeholder={'Abertura\n\nExplicação e demonstração\n\nAplicação prática'} multiline maxLength={50000}
      editable={!busy && !disabled} style={{ height: width > height ? 112 : 180, minHeight: 112, textAlignVertical: 'top' }} />
    <Text style={studioStyles.hint}>Escreva como você fala. O texto acompanha sua gravação sem aparecer no vídeo.</Text>
    <StudioButton label={script.trim() ? 'Usar este roteiro' : 'Aplicar sem roteiro'} icon={<Check size={17} color={colors.text} />}
      loading={busy} disabled={disabled} onPress={() => { void apply(); }} />
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: 13 } });
