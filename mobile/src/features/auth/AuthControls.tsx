import { forwardRef, ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { authColors } from './AuthScene';

export const AuthField = forwardRef<TextInput, TextInputProps & { label: string; icon: ReactNode; password?: boolean }>(function AuthField({ label, icon, password, style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><View style={[styles.inputWrap, focused && styles.focused]}>
    {icon}<TextInput {...props} ref={ref} accessibilityLabel={label} placeholderTextColor="#827C82" selectionColor={authColors.brand} secureTextEntry={password && !visible} style={[styles.input, style]} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} />
    {password && <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'} onPress={() => setVisible(!visible)} style={styles.eye} hitSlop={4}>{visible ? <EyeOff color={authColors.secondary} size={19} /> : <Eye color={authColors.secondary} size={19} />}</Pressable>}
  </View></View>;
});

function GoogleMark() {
  return <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
    <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </Svg>;
}

export function AuthButton({ label, onPress, loading, disabled, google }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; google?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, google && styles.googleButton, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
    {loading ? <ActivityIndicator color="#17080B" /> : google ? <GoogleMark /> : null}<Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export function AuthDivider() { return <View style={styles.divider}><View style={styles.line} /><Text style={styles.dividerText}>ou entre com e-mail</Text><View style={styles.line} /></View>; }
export function AuthNotice({ text, success }: { text?: string | null; success?: boolean }) {
  if (!text) return null;
  return <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.notice, success && styles.success]}><Text style={[styles.noticeText, success && styles.successText]}>{text}</Text></View>;
}
export const authStyles = StyleSheet.create({
  form: { gap: 14 }, forgot: { alignSelf: 'flex-end', minHeight: 40, justifyContent: 'center', marginTop: -8 },
  link: { color: authColors.secondary, fontSize: 13, fontWeight: '500' }, footer: { minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  footerText: { color: authColors.secondary, fontSize: 14, textAlign: 'center' }, footerStrong: { color: authColors.text, fontWeight: '600' },
});
const styles = StyleSheet.create({
  field: { gap: 8 }, label: { color: '#C9C3C7', fontSize: 12, fontWeight: '500' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 6, minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: authColors.border, backgroundColor: authColors.surface },
  focused: { borderColor: authColors.brand }, input: { flex: 1, minHeight: 54, paddingVertical: 14, paddingRight: 8, color: authColors.text, fontSize: 16 },
  eye: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 56, paddingVertical: 16, paddingHorizontal: 20, borderRadius: 14, backgroundColor: authColors.brand, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  googleButton: { backgroundColor: '#F5F3F4' }, buttonText: { color: '#17080B', fontSize: 16, fontWeight: '700' }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.55 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 20 }, line: { flex: 1, height: 1, backgroundColor: '#2E262A' }, dividerText: { color: '#948A90', fontSize: 12 },
  notice: { borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(239,80,102,0.25)', backgroundColor: 'rgba(239,80,102,0.08)' }, noticeText: { color: '#FFADB8', fontSize: 13, lineHeight: 19 },
  success: { borderColor: 'rgba(117,211,169,0.25)', backgroundColor: 'rgba(117,211,169,0.08)' }, successText: { color: '#9EE3C3' },
});
