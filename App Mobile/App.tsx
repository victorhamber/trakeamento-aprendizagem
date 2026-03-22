import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  Image,
  AppState,
  AppStateStatus,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  InteractionManager,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  setAuthToken,
  login as apiLogin,
  getMobileSummary,
  getSites,
  registerPushToken,
  unregisterPushToken,
  AuthExpiredError,
  API_BASE,
  FORGOT_PASSWORD_URL,
  type MobileSummary,
  type SiteRow,
  type ChartPoint,
} from './api';
import { setupAndroidSalesChannel } from './setupNotificationChannels';
import { getExpoPushTokenString } from './expoPush';

const TOKEN_KEY = '@trajettu_token';
const USER_EMAIL_KEY = '@trajettu_user_email';

const PERIODS: { key: string; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: 'last_7d', label: '7 dias' },
  { key: 'last_15d', label: '15 dias' },
  { key: 'last_30d', label: '30 dias' },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

function formatPlatform(p: string | null): string {
  if (!p) return '—';
  const m: Record<string, string> = {
    hotmart: 'Hotmart',
    kiwify: 'Kiwify',
    eduzz: 'Eduzz',
    generic: 'Genérico',
    custom: 'Custom',
  };
  return m[p.toLowerCase()] || p;
}

function formatCurrencySafe(value: unknown, currency: string | null): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = (currency || 'BRL').toUpperCase();
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(n);
}

function formatChartDay(dateStr: string): string {
  const p = dateStr.split('-');
  if (p.length !== 3) return dateStr;
  return `${p[2]}/${p[1]}`;
}

function SalesChart({ points }: { points: ChartPoint[] }) {
  const maxVal = useMemo(() => {
    let m = 0;
    for (const p of points) m = Math.max(m, p.revenue);
    return m > 0 ? m : 1;
  }, [points]);

  if (points.length === 0) {
    return (
      <View style={chartStyles.emptyChart}>
        <Text style={chartStyles.emptyChartText}>Sem vendas neste período e filtros.</Text>
      </View>
    );
  }

  const barMaxH = 120;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chartStyles.scroll}>
      {points.map((p) => {
        const h = Math.max(4, (p.revenue / maxVal) * barMaxH);
        return (
          <View key={p.date} style={chartStyles.barCol}>
            <Text style={chartStyles.barVal} numberOfLines={1}>
              {p.revenue > 0 ? formatCurrencySafe(p.revenue, 'BRL') : '—'}
            </Text>
            <View style={chartStyles.barTrack}>
              <LinearGradient
                colors={['#0a7ea4', '#6366f1']}
                style={[chartStyles.barFill, { height: h }]}
                start={{ x: 0, y: 1 }}
                end={{ x: 0, y: 0 }}
              />
            </View>
            <Text style={chartStyles.barLabel}>{formatChartDay(p.date)}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [authToken, setAuthTokenState] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [summary, setSummary] = useState<MobileSummary | null>(null);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [periodKey, setPeriodKey] = useState('today');
  const [selectedSiteIds, setSelectedSiteIds] = useState<number[]>([]);

  const siteKey = useMemo(
    () =>
      selectedSiteIds
        .slice()
        .sort((a, b) => a - b)
        .join(','),
    [selectedSiteIds]
  );

  const logout = useCallback(async () => {
    try {
      const tok = await getExpoPushTokenString();
      if (tok) await unregisterPushToken(tok);
    } catch {
      /* ignore */
    }
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_EMAIL_KEY]);
    setAuthToken(null);
    setAuthTokenState(null);
    setSummary(null);
    setSites([]);
    setUserEmail('');
    setLoadError(null);
    setPeriodKey('today');
    setSelectedSiteIds([]);
  }, []);

  const handleAuthFailure = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_EMAIL_KEY]);
    setAuthToken(null);
    setAuthTokenState(null);
    setSummary(null);
    setSites([]);
    setUserEmail('');
    setLoadError('Sessão expirada. Entre novamente.');
  }, []);

  const loadToken = useCallback(async () => {
    try {
      const [t, savedEmail] = await AsyncStorage.multiGet([TOKEN_KEY, USER_EMAIL_KEY]);
      const tok = t[1];
      const em = savedEmail[1];
      setAuthTokenState(tok);
      if (tok) setAuthToken(tok);
      if (em) setUserEmail(em);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadToken();
  }, [loadToken]);

  const registerForPush = useCallback(async () => {
    if (!Device.isDevice) return;
    await setupAndroidSalesChannel();
    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    if (final !== 'granted') return;
    const pushTok = await getExpoPushTokenString();
    if (pushTok) await registerPushToken(pushTok, Platform.OS);
  }, []);

  const fetchDashboard = useCallback(async () => {
    setLoadError(null);
    setDataLoading(true);
    try {
      const [sum, siteList] = await Promise.all([
        getMobileSummary({ period: periodKey, siteIds: selectedSiteIds }),
        getSites(),
      ]);
      setSummary(sum);
      setSites(siteList);
    } catch (e: unknown) {
      if (e instanceof AuthExpiredError) {
        await handleAuthFailure();
        return;
      }
      const msg = e instanceof Error ? e.message : 'Não foi possível carregar.';
      setLoadError(msg);
      setSummary(null);
    } finally {
      setDataLoading(false);
    }
  }, [periodKey, selectedSiteIds, handleAuthFailure]);

  useEffect(() => {
    if (!authToken) return;
    void registerForPush();
  }, [authToken, registerForPush]);

  useEffect(() => {
    if (!authToken) return;
    void fetchDashboard();
  }, [authToken, periodKey, siteKey, fetchDashboard]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      void fetchDashboard();
    });
    return () => sub.remove();
  }, [fetchDashboard]);

  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active' && authToken) {
        void fetchDashboard();
        void registerForPush();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [authToken, fetchDashboard, registerForPush]);

  const onLogin = async () => {
    setLoginError('');
    if (!email.trim() || !password) {
      setLoginError('Email e senha são obrigatórios.');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await apiLogin(email.trim().toLowerCase(), password);
      await AsyncStorage.setItem(TOKEN_KEY, res.token);
      await AsyncStorage.setItem(USER_EMAIL_KEY, res.user.email);
      setAuthToken(res.token);
      setAuthTokenState(res.token);
      setUserEmail(res.user.email);
      InteractionManager.runAfterInteractions(() => {
        void fetchDashboard();
      });
    } catch (e: unknown) {
      setLoginError(e instanceof Error ? e.message : 'Falha no login.');
    } finally {
      setLoginLoading(false);
    }
  };

  const onLogout = () => {
    Alert.alert('Sair', 'Deseja sair do app?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchDashboard();
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toggleSite = (id: number) => {
    setSelectedSiteIds((prev) => {
      if (prev.length === 0) return [id];
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next;
      }
      return [...prev, id].sort((a, b) => a - b);
    });
  };

  const selectAllSites = () => setSelectedSiteIds([]);

  const periodLabel = PERIODS.find((p) => p.key === periodKey)?.label ?? 'Período';

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0a7ea4" />
          <StatusBar style="light" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!authToken) {
    return (
      <SafeAreaProvider>
        <LinearGradient colors={['#05070a', '#0a0612', '#05070a']} style={styles.loginGradient}>
          <SafeAreaView style={styles.safeLogin} edges={['top', 'bottom']}>
            <StatusBar style="light" />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.keyboardView}
            >
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginScroll}>
                <View style={styles.loginCard}>
                  <Image
                    source={require('./assets/logo-full.png')}
                    style={styles.loginLogo}
                    resizeMode="contain"
                    accessibilityLabel="Trajettu AI Analytics"
                  />
                  <Text style={styles.welcomeTitle}>Bem-vindo de volta!</Text>
                  <Text style={styles.welcomeSub}>Acesse seu painel</Text>

                  <Text style={styles.fieldLabel}>Email</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="mail-outline" size={20} color="#71717a" style={styles.inputIcon} />
                    <TextInput
                      style={styles.inputInner}
                      placeholder="seu@email.com"
                      placeholderTextColor="#52525b"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoComplete="email"
                      selectionColor="#22d3ee"
                    />
                  </View>

                  <Text style={styles.fieldLabel}>Senha</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="lock-closed-outline" size={20} color="#71717a" style={styles.inputIcon} />
                    <TextInput
                      style={styles.inputInner}
                      placeholder="••••••••"
                      placeholderTextColor="#52525b"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoComplete="password"
                      selectionColor="#22d3ee"
                    />
                  </View>

                  {loginError ? <Text style={styles.error}>{loginError}</Text> : null}

                  <TouchableOpacity
                    style={styles.gradientBtnWrap}
                    onPress={onLogin}
                    disabled={loginLoading}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#0a7ea4', '#6366f1', '#7c3aed']}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.gradientBtn}
                    >
                      {loginLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.gradientBtnText}>Entrar</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>

                  <Pressable
                    onPress={() => Linking.openURL(FORGOT_PASSWORD_URL)}
                    style={styles.forgotWrap}
                  >
                    <Text style={styles.forgotText}>
                      Esqueceu sua senha? <Text style={styles.forgotLink}>Recuperar senha</Text>
                    </Text>
                  </Pressable>

                  {__DEV__ ? (
                    <Text style={styles.apiHint} numberOfLines={2}>
                      API: {API_BASE}
                    </Text>
                  ) : null}
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </LinearGradient>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image source={require('./assets/icon.png')} style={styles.headerLogo} resizeMode="contain" accessibilityLabel="Trajettu" />
            <View style={styles.headerTextCol}>
              <Text style={styles.brandSmall}>Trajettu</Text>
              <Text style={styles.headerEmail} numberOfLines={1}>
                {userEmail || '—'}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onLogout} hitSlop={12}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>

        {loadError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchDashboard()}>
              <Text style={styles.retryBtnText}>Tentar de novo</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0a7ea4"
              colors={['#0a7ea4']}
              progressBackgroundColor="#121826"
            />
          }
        >
          <Text style={styles.sectionLabel}>Período</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
            {PERIODS.map((p) => {
              const active = periodKey === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.periodChip, active && styles.periodChipActive]}
                  onPress={() => setPeriodKey(p.key)}
                >
                  <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {dataLoading && !summary ? (
            <ActivityIndicator size="large" color="#0a7ea4" style={styles.loader} />
          ) : summary ? (
            <>
              <Text style={styles.sectionLabel}>Resumo · {periodLabel}</Text>
              <View style={styles.statGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Vendas</Text>
                  <Text style={styles.statValue}>{summary.periodSales}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Receita</Text>
                  <Text style={styles.statValue}>{formatCurrencySafe(summary.periodRevenue, 'BRL')}</Text>
                </View>
              </View>

              <View style={styles.inlineMeta}>
                <Text style={styles.inlineMetaText}>
                  {Math.max(sites.length, summary.sitesCount)} site
                  {Math.max(sites.length, summary.sitesCount) === 1 ? '' : 's'} na conta
                </Text>
              </View>

              <Text style={styles.sectionLabel}>Receita por dia</Text>
              <View style={styles.chartCard}>
                <SalesChart points={summary.chart} />
              </View>

              {sites.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>Sites</Text>
                  <Text style={styles.filterHint}>Toque em &quot;Todos&quot; ou combine um ou mais sites.</Text>
                  <View style={styles.siteChips}>
                    <TouchableOpacity
                      style={[styles.siteChip, selectedSiteIds.length === 0 && styles.siteChipActive]}
                      onPress={selectAllSites}
                    >
                      <Text
                        style={[styles.siteChipName, selectedSiteIds.length === 0 && styles.siteChipNameActive]}
                      >
                        Todos
                      </Text>
                    </TouchableOpacity>
                    {sites.map((s) => {
                      const active =
                        selectedSiteIds.length === 0 ? false : selectedSiteIds.includes(s.id);
                      return (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.siteChip, active && styles.siteChipActive]}
                          onPress={() => toggleSite(s.id)}
                        >
                          <Text style={[styles.siteChipName, active && styles.siteChipNameActive]} numberOfLines={1}>
                            {s.name}
                          </Text>
                          {s.domain ? (
                            <Text style={styles.siteChipDomain} numberOfLines={1}>
                              {s.domain}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Text style={styles.sectionLabel}>Últimas vendas</Text>
              {summary.recentPurchases.length === 0 ? (
                <Text style={styles.empty}>
                  Nenhuma venda neste período com os filtros atuais.
                </Text>
              ) : (
                summary.recentPurchases.map((p) => (
                  <View key={p.id} style={styles.row}>
                    <View style={styles.rowLeft}>
                      <View style={styles.rowTop}>
                        <Text style={styles.rowOrder}>#{p.orderId}</Text>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{formatPlatform(p.platform)}</Text>
                        </View>
                      </View>
                      <Text style={styles.rowSite}>{p.siteName}</Text>
                      <Text style={styles.rowDate}>{formatDate(p.createdAt)}</Text>
                    </View>
                    <Text style={styles.rowAmount}>
                      {p.amount != null ? formatCurrencySafe(p.amount, p.currency) : '—'}
                    </Text>
                  </View>
                ))
              )}
            </>
          ) : (
            <Text style={styles.empty}>Não foi possível carregar os dados.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const chartStyles = StyleSheet.create({
  scroll: { paddingVertical: 8, gap: 8, alignItems: 'flex-end' },
  barCol: { width: 72, marginHorizontal: 4, alignItems: 'center' },
  barVal: { fontSize: 9, color: '#a1a1aa', marginBottom: 4, maxWidth: 70 },
  barTrack: {
    width: 36,
    height: 120,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 8 },
  barLabel: { fontSize: 10, color: '#71717a', marginTop: 6 },
  emptyChart: { padding: 16, alignItems: 'center' },
  emptyChartText: { color: '#71717a', fontSize: 13 },
});

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#05070a' },
  loginGradient: { flex: 1 },
  safeLogin: { flex: 1 },
  keyboardView: { flex: 1 },
  container: { flex: 1, backgroundColor: '#05070a' },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 40 },
  loginCard: {
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: '#12141a',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  loginLogo: { width: '100%', height: 56, marginBottom: 20, maxWidth: 280, alignSelf: 'center' },
  welcomeTitle: { fontSize: 22, fontWeight: '700', color: '#fafafa', marginBottom: 4 },
  welcomeSub: { fontSize: 15, color: '#a1a1aa', marginBottom: 20 },
  fieldLabel: { fontSize: 13, color: '#a1a1aa', marginBottom: 6, marginTop: 4 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b0f17',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  inputInner: { flex: 1, paddingVertical: 14, fontSize: 16, color: '#f4f4f5' },
  apiHint: { fontSize: 11, color: '#52525b', marginTop: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: '#f87171', marginBottom: 8, fontSize: 14 },
  gradientBtnWrap: { marginTop: 8, borderRadius: 14, overflow: 'hidden' },
  gradientBtn: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  gradientBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  forgotWrap: { marginTop: 18, alignItems: 'center' },
  forgotText: { fontSize: 14, color: '#71717a' },
  forgotLink: { color: '#a78bfa', fontWeight: '600' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#080a0f',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerLeft: { flex: 1, marginRight: 12, flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 40, height: 40, marginRight: 10 },
  headerTextCol: { flex: 1, minWidth: 0 },
  brandSmall: { fontSize: 13, fontWeight: '800', color: '#22d3ee' },
  headerEmail: { fontSize: 12, color: '#a1a1aa', marginTop: 2 },
  logoutText: { fontSize: 15, color: '#22d3ee', fontWeight: '600' },
  errorBanner: {
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(234, 179, 8, 0.35)',
  },
  errorBannerText: { color: '#fde68a', fontSize: 13, marginBottom: 8 },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(234, 179, 8, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryBtnText: { color: '#fef3c7', fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loader: { marginTop: 48 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  periodRow: { flexDirection: 'row', flexWrap: 'nowrap', paddingBottom: 12, gap: 8 },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0b0f17',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  periodChipActive: {
    borderColor: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
  },
  periodChipText: { fontSize: 13, color: '#a1a1aa', fontWeight: '600' },
  periodChipTextActive: { color: '#e0f2fe' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 8 },
  statCard: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  statLabel: { fontSize: 12, color: '#a1a1aa', marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#f4f4f5' },
  inlineMeta: { marginBottom: 16 },
  inlineMetaText: { fontSize: 13, color: '#71717a' },
  chartCard: {
    backgroundColor: '#0b0f17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  filterHint: { fontSize: 12, color: '#52525b', marginBottom: 8 },
  siteChips: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 },
  siteChip: {
    backgroundColor: '#0b0f17',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    margin: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    maxWidth: '100%',
  },
  siteChipActive: {
    borderColor: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
  },
  siteChipName: { fontSize: 14, fontWeight: '600', color: '#e4e4e7' },
  siteChipNameActive: { color: '#e0f2fe' },
  siteChipDomain: { fontSize: 11, color: '#71717a', marginTop: 2 },
  empty: { color: '#a1a1aa', fontSize: 14, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#0b0f17',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  rowLeft: { flex: 1, marginRight: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  rowOrder: { fontSize: 15, fontWeight: '700', color: '#f4f4f5' },
  badge: {
    backgroundColor: 'rgba(10, 126, 164, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#67e8f9' },
  rowSite: { fontSize: 13, color: '#a1a1aa', marginTop: 4 },
  rowDate: { fontSize: 12, color: '#71717a', marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: '#22d3ee' },
});
