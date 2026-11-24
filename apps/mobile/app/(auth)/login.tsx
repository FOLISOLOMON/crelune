import { type ComponentRef, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { loginSchema } from '@crelune/shared';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AuthSessionError,
  TemporaryRefreshError,
} from '@/auth/session-manager';
import { BrandMark } from '@/components/ui/BrandMark';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { SurfaceCard } from '@/components/ui/SurfaceCard';
import { resolveMobileApiBaseUrl } from '@/config/env';
import { useAuth } from '@/providers/AuthProvider';
import { useNetworkStatus } from '@/providers/NetworkProvider';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';

export default function LoginScreen() {
  const { login, notice, clearNotice } = useAuth();
  const { isOnline } = useNetworkStatus();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTone, setErrorTone] = useState<'error' | 'warning'>('error');

  const passwordInputRef = useRef<ComponentRef<typeof TextInput>>(null);

  let devServerHint: string | null = null;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      devServerHint = resolveMobileApiBaseUrl();
    } catch {
      devServerHint = 'API URL not configured';
    }
  }

  const handleSignIn = async () => {
    if (submitting) return;

    setErrorMessage(null);
    clearNotice();

    if (!isOnline) {
      setErrorTone('warning');
      setErrorMessage(
        'You appear to be offline. Connect to the internet to sign in to CRELUNE.'
      );
      return;
    }

    const parsed = loginSchema.safeParse({
      email: email.trim().toLowerCase(),
      password,
    });
    if (!parsed.success) {
      setErrorTone('error');
      setErrorMessage(
        parsed.error.issues[0]?.message ??
          'Please enter a valid email address and password.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
    } catch (err) {
      if (err instanceof TemporaryRefreshError) {
        setErrorTone('warning');
        setErrorMessage(err.message);
      } else if (err instanceof AuthSessionError) {
        setErrorTone('error');
        setErrorMessage(err.message);
      } else {
        setErrorTone('error');
        setErrorMessage('Unable to complete sign-in. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandBlock}>
            <BrandMark size={48} showWordmark showTagline />
            <Text style={styles.subtitle}>
              Personal creative &amp; media operations companion. Sign in with your
              owner account to continue.
            </Text>
          </View>

          {notice ? (
            <StatusBanner
              testID="session-notice-banner"
              tone="warning"
              title="Sign-in required"
              message={notice}
            />
          ) : null}

          {errorMessage ? (
            <StatusBanner
              testID="login-error-banner"
              tone={errorTone}
              message={errorMessage}
            />
          ) : null}

          <SurfaceCard style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={typography.label} nativeID="email-label">
                Owner Email
              </Text>
              <TextInput
                testID="login-email-input"
                accessibilityLabel="Owner Email"
                accessibilityLabelledBy="email-label"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
                editable={!submitting}
                placeholder="owner@example.com"
                placeholderTextColor={colors.text.muted}
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                style={styles.input}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={typography.label} nativeID="password-label">
                Password
              </Text>
              <View style={styles.passwordRow}>
                <TextInput
                  ref={passwordInputRef}
                  testID="login-password-input"
                  accessibilityLabel="Password"
                  accessibilityLabelledBy="password-label"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  editable={!submitting}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.text.muted}
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={() => {
                    void handleSignIn();
                  }}
                  style={[styles.input, styles.passwordInput]}
                />
                <Pressable
                  testID="toggle-password-visibility"
                  accessibilityRole="button"
                  accessibilityLabel={
                    showPassword ? 'Hide password' : 'Show password'
                  }
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={styles.eyeButton}
                >
                  {showPassword ? (
                    <EyeOff size={20} color={colors.text.secondary} />
                  ) : (
                    <Eye size={20} color={colors.text.secondary} />
                  )}
                </Pressable>
              </View>
            </View>

            <PrimaryButton
              testID="login-submit-button"
              label="Sign In to CRELUNE"
              onPress={() => {
                void handleSignIn();
              }}
              isLoading={submitting}
              disabled={submitting}
              style={styles.submitButton}
            />
          </SurfaceCard>

          <View style={styles.securityFoot}>
            <View style={styles.securityRow}>
              <ShieldCheck size={16} color={colors.primary.DEFAULT} />
              <Text style={styles.securityText}>
                Protected by per-device rotating credentials in hardware-backed
                secure storage.
              </Text>
            </View>
            <View style={styles.securityRow}>
              <Lock size={15} color={colors.text.secondary} />
              <Text style={styles.securityText}>
                Single-owner workspace. Public registration is disabled.
              </Text>
            </View>
            {devServerHint ? (
              <Text testID="dev-server-hint" style={styles.devHint}>
                Dev API target: {devServerHint}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  brandBlock: {
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  fieldGroup: {
    gap: spacing.sm,
  },
  input: {
    minHeight: touchTarget.min,
    borderWidth: 1,
    borderColor: colors.border.DEFAULT,
    borderRadius: radii.md,
    backgroundColor: colors.surface.subtle,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text.primary,
  },
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeButton: {
    position: 'absolute',
    right: 0,
    width: touchTarget.min,
    height: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButton: {
    marginTop: spacing.xs,
  },
  securityFoot: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  securityText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 17,
  },
  devHint: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.text.muted,
    textAlign: 'center',
  },
});
