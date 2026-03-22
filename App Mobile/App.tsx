import { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  setAuthToken,
  login as apiLogin,
  getMobileSummary,
  getSites,
  registerPushToken,
  unregisterPushToken,
  AuthExpiredError,
  API_BASE,
  type MobileSummary,
  type SiteRow,
} from './api';

const TOKEN_KEY = '@trajettu_token';
const USER_EMAIL_KEY = '@trajettu_user_email';

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

  const logout = useCallback(async () => {
    try {
      const { data } = await Notifications.getExpoPushTokenAsync();
      if (data) await unregisterPushToken(data);
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
    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    if (final !== 'granted') return;
    const { data: pushTok } = await Notifications.getExpoPushTokenAsync();
    if (pushTok) await registerPushToken(pushTok, 'expo');
  }, []);

  const fetchDashboard = useCallback(async () => {
    setLoadError(null);
    setDataLoading(true);
    try {
      const [sum, siteList] = await Promise.all([getMobileSummary(), getSites()]);
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
  }, [handleAuthFailure]);

  useEffect(() => {
    if (!authToken) return;
    registerForPush();
    fetchDashboard();
  }, [authToken, registerForPush, fetchDashboard]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      fetchDashboard();
    });
    return () => sub.remove();
  }, [fetchDashboard]);

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

  const formatCurrency = (value: number, currency: string | null) => {
    const code = (currency || 'BRL').toUpperCase();
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(value);
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

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0a7ea4" />
          <StatusBar style="auto" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!authToken) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <StatusBar style="auto" />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginScroll}>
            <View style={styles.loginBox}>
              <Text style={styles.brand}>Trajettu</Text>
              <Text style={styles.title}>Painel de vendas</Text>
              <Text style={styles.subtitle}>
                Acompanhe vendas e receba alertas quando fechar pedido (push).
              </Text>
              <Text style={styles.apiHint} numberOfLines={2}>
                API: {API_BASE}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                placeholderTextColor="#888"
              />
              <TextInput
                style={styles.input}
                placeholder="Senha"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
                placeholderTextColor="#888"
              />
              {loginError ? <Text style={styles.error}>{loginError}</Text> : null}
              <TouchableOpacity style={styles.button} onPress={onLogin} disabled={loginLoading}>
                {loginLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Entrar</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="auto" />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.brandSmall}>Trajettu</Text>
            <Text style={styles.headerEmail} numberOfLines={1}>
              {userEmail || '—'}
            </Text>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {dataLoading && !summary ? (
            <ActivityIndicator size="large" color="#0a7ea4" style={styles.loader} />
          ) : summary ? (
            <>
              <Text style={styles.sectionLabel}>Hoje</Text>
              <View style={styles.statGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Vendas</Text>
                  <Text style={styles.statValue}>{summary.todaySales}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Receita</Text>
                  <Text style={styles.statValue}>{formatCurrency(summary.todayRevenue, 'BRL')}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>7 dias · vendas</Text>
                  <Text style={styles.statValue}>{summary.weekSales}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>7 dias · receita</Text>
                  <Text style={styles.statValue}>{formatCurrency(summary.weekRevenue, 'BRL')}</Text>
                </View>
              </View>

              <View style={styles.inlineMeta}>
                <Text style={styles.inlineMetaText}>
                  {summary.sitesCount} site{summary.sitesCount === 1 ? '' : 's'} na conta
                </Text>
              </View>

              {sites.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>Seus sites</Text>
                  <View style={styles.siteChips}>
                    {sites.map((s) => (
                      <View key={s.id} style={styles.siteChip}>
                        <Text style={styles.siteChipName} numberOfLines={1}>
                          {s.name}
                        </Text>
                        {s.domain ? (
                          <Text style={styles.siteChipDomain} numberOfLines={1}>
                            {s.domain}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.sectionLabel}>Últimas vendas</Text>
              {summary.recentPurchases.length === 0 ? (
                <Text style={styles.empty}>
                  Nenhuma venda ainda. Quando os webhooks registrarem compras aprovadas, elas aparecem aqui.
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
                      {p.amount != null ? formatCurrency(p.amount, p.currency) : '—'}
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

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f4f8' },
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  loginBox: { maxWidth: 400, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 32, fontWeight: '800', color: '#0a7ea4', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#555', marginBottom: 12, lineHeight: 22 },
  apiHint: { fontSize: 11, color: '#888', marginBottom: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: '#c00', marginBottom: 8, fontSize: 14 },
  button: {
    backgroundColor: '#0a7ea4',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  headerLeft: { flex: 1, marginRight: 12 },
  brandSmall: { fontSize: 13, fontWeight: '800', color: '#0a7ea4' },
  headerEmail: { fontSize: 12, color: '#666', marginTop: 2 },
  logoutText: { fontSize: 15, color: '#0a7ea4', fontWeight: '600' },
  errorBanner: {
    backgroundColor: '#fff3cd',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ffc107',
  },
  errorBannerText: { color: '#856404', fontSize: 13, marginBottom: 8 },
  retryBtn: { alignSelf: 'flex-start', backgroundColor: '#856404', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  retryBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loader: { marginTop: 48 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 8 },
  statCard: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  statLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#111' },
  inlineMeta: { marginBottom: 16 },
  inlineMetaText: { fontSize: 13, color: '#888' },
  siteChips: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 },
  siteChip: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    margin: 4,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    maxWidth: '100%',
  },
  siteChipName: { fontSize: 14, fontWeight: '600', color: '#111' },
  siteChipDomain: { fontSize: 11, color: '#888', marginTop: 2 },
  empty: { color: '#666', fontSize: 14, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  rowLeft: { flex: 1, marginRight: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  rowOrder: { fontSize: 15, fontWeight: '700', color: '#111' },
  badge: {
    backgroundColor: '#e8f4f8',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#0a7ea4' },
  rowSite: { fontSize: 13, color: '#555', marginTop: 4 },
  rowDate: { fontSize: 12, color: '#999', marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: '#0a7ea4' },
});
