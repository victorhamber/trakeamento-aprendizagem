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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setAuthToken,
  login as apiLogin,
  getMobileSummary,
  registerPushToken,
  unregisterPushToken,
  type MobileSummary,
} from './api';

const TOKEN_KEY = '@trajettu_token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

export default function App() {
  const [loading, setLoading] = useState(true);
  const [authToken, setAuthTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [summary, setSummary] = useState<MobileSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadToken = useCallback(async () => {
    try {
      const t = await AsyncStorage.getItem(TOKEN_KEY);
      setAuthTokenState(t);
      if (t) setAuthToken(t);
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
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (token) await registerPushToken(token, 'expo');
  }, []);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const data = await getMobileSummary();
      setSummary(data);
    } catch (e) {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authToken) {
      registerForPush();
      fetchSummary();
    }
  }, [authToken, registerForPush, fetchSummary]);

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
      setAuthToken(res.token);
      setAuthTokenState(res.token);
    } catch (e: any) {
      setLoginError(e?.message || 'Falha no login.');
    } finally {
      setLoginLoading(false);
    }
  };

  const onLogout = () => {
    Alert.alert('Sair', 'Deseja sair do app?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          Notifications.getExpoPushTokenAsync()
            .then(({ data }) => unregisterPushToken(data))
            .catch(() => {});
          await AsyncStorage.removeItem(TOKEN_KEY);
          setAuthToken(null);
          setAuthTokenState(null);
          setSummary(null);
        },
      },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSummary();
    setRefreshing(false);
  };

  const formatCurrency = (value: number, currency: string | null) => {
    const code = (currency || 'BRL').toUpperCase();
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(value);
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (!authToken) {
    return (
      <View style={styles.container}>
        <StatusBar style="auto" />
        <View style={styles.loginBox}>
          <Text style={styles.title}>Trajettu</Text>
          <Text style={styles.subtitle}>App de vendas</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor="#888"
          />
          <TextInput
            style={styles.input}
            placeholder="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vendas</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {summaryLoading && !summary ? (
          <ActivityIndicator size="large" color="#0a7ea4" style={styles.loader} />
        ) : summary ? (
          <>
            <View style={styles.cards}>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Vendas hoje</Text>
                <Text style={styles.cardValue}>{summary.todaySales}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Receita hoje</Text>
                <Text style={styles.cardValue}>{formatCurrency(summary.todayRevenue, 'BRL')}</Text>
              </View>
            </View>
            <Text style={styles.sectionTitle}>Últimas vendas</Text>
            {summary.recentPurchases.length === 0 ? (
              <Text style={styles.empty}>Nenhuma venda recente.</Text>
            ) : (
              summary.recentPurchases.map((p) => (
                <View key={p.id} style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowOrder}>#{p.orderId}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loginBox: { flex: 1, padding: 24, justifyContent: 'center', maxWidth: 340, alignSelf: 'center', width: '100%' },
  title: { fontSize: 28, fontWeight: '700', color: '#111', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: '#c00', marginBottom: 8, fontSize: 14 },
  button: {
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  logoutText: { fontSize: 15, color: '#0a7ea4' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  loader: { marginTop: 48 },
  cards: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eee',
  },
  cardLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  cardValue: { fontSize: 20, fontWeight: '700', color: '#111' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  empty: { color: '#888', fontSize: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  rowLeft: { flex: 1 },
  rowOrder: { fontSize: 15, fontWeight: '600', color: '#111' },
  rowSite: { fontSize: 13, color: '#666' },
  rowDate: { fontSize: 12, color: '#999', marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '600', color: '#0a7ea4' },
});
