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
  Dimensions,
  Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
const TOKEN_KEY = '@trajettu_token';
const USER_EMAIL_KEY = '@trajettu_user_email';

/** Presets alinhados ao dashboard web (select de período) */
const PERIOD_PRESETS: { key: string; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: 'last_7d', label: 'Últimos 7 dias' },
  { key: 'last_14d', label: 'Últimos 14 dias' },
  { key: 'last_30d', label: 'Últimos 30 dias' },
  { key: 'maximum', label: 'Máximo' },
];

const PERIOD_ROW_SELECTED = '#2563eb';

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ymdToBr(ymd: string): string {
  const p = ymd.split('-');
  if (p.length !== 3) return ymd;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function defaultCustomRange(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { since: toYmd(since), until: toYmd(until) };
}

function parseYmdToDate(ymd: string): Date {
  const p = ymd.split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return new Date();
  return new Date(p[0], p[1] - 1, p[2]);
}

function ymdLocalTime(ymd: string): number {
  const p = ymd.split('-').map(Number);
  if (p.length !== 3) return 0;
  return new Date(p[0], p[1] - 1, p[2]).getTime();
}

/** Evita intervalo no futuro (relógio errado / ano errado) e garante since ≤ until */
function clampCustomRange(since: string, until: string): { since: string; until: string } {
  const today = new Date();
  const todayYmd = toYmd(today);
  let s = since;
  let u = until;
  if (ymdLocalTime(u) > ymdLocalTime(todayYmd)) u = todayYmd;
  if (ymdLocalTime(s) > ymdLocalTime(todayYmd)) s = todayYmd;
  if (ymdLocalTime(s) > ymdLocalTime(u)) {
    s = u;
  }
  return { since: s, until: u };
}

/** Paleta unificada (dark premium) */
const C = {
  bg: '#030508',
  bgElevated: '#0c1018',
  surface: '#111827',
  surface2: '#151d2e',
  border: 'rgba(148, 163, 184, 0.12)',
  borderStrong: 'rgba(56, 189, 248, 0.38)',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  accent: '#38bdf8',
  accentDeep: '#0284c7',
  accentSoft: 'rgba(56, 189, 248, 0.16)',
  purple: '#8b5cf6',
};

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

function formatCurrencyLabel(code: string | null): string {
  const value = (code || '').toUpperCase();
  if (value === 'BRL') return 'Real brasileiro';
  if (value === 'USD') return 'Dólar americano';
  if (!value) return 'Todas as moedas';
  return value;
}

function formatCurrencySafe(value: unknown, currency: string | null): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = (currency || 'BRL').toUpperCase();
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(n);
}

/** Evita SVG com dezenas de milhares de px (período máximo) — mantém forma da série */
function formatNumberSafe(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'â€”';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

function bucketChartPointsByCount(points: ChartPoint[], max: number): ChartPoint[] {
  if (points.length <= max || points.length === 0) return points;
  const out: ChartPoint[] = [];
  const n = points.length;
  for (let b = 0; b < max; b++) {
    const i0 = Math.floor((b * n) / max);
    const i1 = Math.floor(((b + 1) * n) / max) - 1;
    let rev = 0;
    let sal = 0;
    for (let i = i0; i <= i1; i++) {
      rev += points[i].revenue;
      sal += points[i].sales;
    }
    const mid = Math.floor((i0 + i1) / 2);
    out.push({ date: points[mid].date, revenue: rev, sales: sal });
  }
  return out;
}

const MAX_LINE_POINTS = 100;

function formatChartAxisDate(dateStr: string): string {
  const p = dateStr.split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return dateStr;
  const [y, m, d] = p;
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Mesmo critério do RevenueChart web (Recharts): moeda compacta no eixo Y */
function formatCurrencyCompact(value: number, currency: string | null): string {
  if (!currency) return formatNumberSafe(value);
  try {
    return new Intl.NumberFormat(currency === 'BRL' ? 'pt-BR' : 'en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return formatCurrencySafe(value, currency);
  }
}

/** Gráfico de linha alinhado ao dashboard web (`RevenueChart.tsx`): linha verde, grade horizontal, eixos */
function SalesChart({ points, currency = 'BRL' }: { points: ChartPoint[]; currency?: string | null }) {
  const PLOT_H = 208;
  const Y_AXIS_W = 56;
  const MIN_PT = 34;
  const lineColor = '#34d399';
  const gridColor = 'rgba(255,255,255,0.06)';
  const dotStroke = '#18181b';

  const [plotBoxW, setPlotBoxW] = useState(() => Math.max(280, Dimensions.get('window').width - 80));

  const displayPoints = useMemo(() => bucketChartPointsByCount(points, MAX_LINE_POINTS), [points]);

  const chartData = useMemo(() => {
    let d = displayPoints.map((p) => ({ ...p }));
    if (d.length === 1) {
      const parts = d[0].date.split('-').map(Number);
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        const [y, mo, day] = parts;
        const dt = new Date(y, mo - 1, day);
        dt.setDate(dt.getDate() - 1);
        const py = dt.getFullYear();
        const pm = String(dt.getMonth() + 1).padStart(2, '0');
        const pd = String(dt.getDate()).padStart(2, '0');
        d = [{ date: `${py}-${pm}-${pd}`, revenue: 0, sales: 0 }, ...d];
      }
    }
    return d;
  }, [displayPoints]);

  const maxRev = useMemo(() => {
    let m = 0;
    for (const p of chartData) m = Math.max(m, p.revenue);
    return m > 0 ? m : 1;
  }, [chartData]);

  if (points.length === 0) {
    return (
      <View style={chartStyles.emptyChart}>
        <Ionicons name="analytics-outline" size={28} color={C.textDim} style={{ marginBottom: 8 }} />
        <Text style={chartStyles.emptyChartText}>Sem dados no período selecionado</Text>
      </View>
    );
  }

  const n = chartData.length;
  const available = Math.max(0, plotBoxW - Y_AXIS_W);
  const innerW = n <= 1 ? available : Math.max(available, (n - 1) * MIN_PT);
  const scrolls = innerW > available + 0.5;

  const toY = (rev: number) => PLOT_H - (rev / maxRev) * PLOT_H;
  const toX = (i: number) => (n <= 1 ? innerW / 2 : (i / Math.max(n - 1, 1)) * innerW);

  const coords = chartData.map((p, i) => ({
    x: toX(i),
    y: toY(p.revenue),
  }));
  const polylinePts = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const gridFracs = [0, 0.25, 0.5, 0.75, 1];

  const plotBlock = (
    <View style={{ width: innerW }}>
      <Svg width={innerW} height={PLOT_H}>
        {gridFracs.map((f) => {
          const y = PLOT_H - f * PLOT_H;
          return (
            <Line
              key={f}
              x1={0}
              y1={y}
              x2={innerW}
              y2={y}
              stroke={gridColor}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          );
        })}
        <Polyline
          points={polylinePts}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((c, i) => (
          <Circle
            key={`${chartData[i].date}-${i}`}
            cx={c.x}
            cy={c.y}
            r={4}
            fill={lineColor}
            stroke={dotStroke}
            strokeWidth={2}
          />
        ))}
      </Svg>
      <View style={[chartStyles.xLabels, { width: innerW }]}>
        {chartData.map((p) => (
          <Text key={p.date} style={chartStyles.xTick} numberOfLines={1}>
            {formatChartAxisDate(p.date)}
          </Text>
        ))}
      </View>
    </View>
  );

  return (
    <View style={chartStyles.chartOuter}>
      <View
        style={chartStyles.chartInner}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0) setPlotBoxW(w);
        }}
      >
        <View style={chartStyles.chartRow}>
          <View style={[chartStyles.yAxis, { height: PLOT_H }]}>
            {[1, 0.75, 0.5, 0.25, 0].map((frac) => (
              <Text key={frac} style={chartStyles.yTick} numberOfLines={1}>
                {formatCurrencyCompact(frac * maxRev, currency)}
              </Text>
            ))}
          </View>
          {scrolls ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              bounces={false}
              style={chartStyles.chartScroll}
              contentContainerStyle={{ minWidth: innerW }}
            >
              {plotBlock}
            </ScrollView>
          ) : (
            <View style={chartStyles.chartScroll}>{plotBlock}</View>
          )}
        </View>
      </View>
    </View>
  );
}

function DropdownPicker({
  label, value, options, onChange, icon, allowClear, clearLabel
}: {
  label: string; value: string | null; options: {key: string; label: string}[];
  onChange: (k: string | null) => void; icon: any; allowClear?: boolean; clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selectedLabel = value ? options.find(o => o.key === value)?.label : (clearLabel || 'Selecione');
  return (
    <>
      <TouchableOpacity style={dropdownStyles.trigger} onPress={() => setOpen(true)} activeOpacity={0.88}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={dropdownStyles.iconBg}>
            <Ionicons name={icon} size={18} color={C.accent} />
          </View>
          <View>
            <Text style={dropdownStyles.label}>{label}</Text>
            <Text style={dropdownStyles.val} numberOfLines={1}>{selectedLabel}</Text>
          </View>
        </View>
        <Ionicons name="chevron-down" size={20} color={C.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={dropdownStyles.modalRoot}>
          <Pressable style={dropdownStyles.modalBackdrop} onPress={() => setOpen(false)} />
          <View style={[dropdownStyles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <Text style={dropdownStyles.modalTitle}>{label}</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 16 }}>
              {allowClear && (
                <TouchableOpacity style={[dropdownStyles.row, value === null && dropdownStyles.rowActive]} onPress={() => {onChange(null); setOpen(false);}} activeOpacity={0.85}>
                  <Text style={[dropdownStyles.rowText, value === null && dropdownStyles.rowTextActive]}>{clearLabel}</Text>
                </TouchableOpacity>
              )}
              {options.map((o) => (
                <TouchableOpacity key={o.key} style={[dropdownStyles.row, value === o.key && dropdownStyles.rowActive]} onPress={() => {onChange(o.key); setOpen(false);}} activeOpacity={0.85}>
                  <Text style={[dropdownStyles.rowText, value === o.key && dropdownStyles.rowTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const dropdownStyles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(17, 24, 39, 0.88)', borderWidth: 1, borderColor: C.border, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 3,
  },
  iconBg: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(56,189,248,0.1)', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, color: C.textDim, textTransform: 'uppercase', fontWeight: '800', marginBottom: 2, letterSpacing: 0.5 },
  val: { fontSize: 15, color: C.text, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: { backgroundColor: C.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 18, paddingHorizontal: 16, maxHeight: '70%', borderWidth: 1, borderColor: C.border },
  modalTitle: { fontSize: 13, fontWeight: '800', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16 },
  row: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4, borderWidth: 1, borderColor: 'transparent' },
  rowActive: { backgroundColor: PERIOD_ROW_SELECTED, borderColor: 'rgba(255,255,255,0.12)' },
  rowText: { fontSize: 16, fontWeight: '600', color: C.text },
  rowTextActive: { color: '#fff' }
});

export default function App() {
  const insets = useSafeAreaInsets();
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
  const [periodModalVisible, setPeriodModalVisible] = useState(false);
  const [periodModalStep, setPeriodModalStep] = useState<'list' | 'custom'>('list');
  const [showSincePicker, setShowSincePicker] = useState(false);
  const [showUntilPicker, setShowUntilPicker] = useState(false);
  const [customSince, setCustomSince] = useState(() => defaultCustomRange().since);
  const [customUntil, setCustomUntil] = useState(() => defaultCustomRange().until);
  const [selectedSiteIds, setSelectedSiteIds] = useState<number[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0);
  const [purchasesPage, setPurchasesPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMorePurchases, setHasMorePurchases] = useState(false);
  const siteKey = useMemo(
    () =>
      selectedSiteIds
        .slice()
        .sort((a, b) => a - b)
        .join(','),
    [selectedSiteIds]
  );

  const customRangeForApi = useMemo(() => {
    if (periodKey !== 'custom') return null;
    return clampCustomRange(customSince, customUntil);
  }, [periodKey, customSince, customUntil]);

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
    const dr = defaultCustomRange();
    setCustomSince(dr.since);
    setCustomUntil(dr.until);
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

  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/USD')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.rates) {
          setExchangeRates(data.rates);
        }
      })
      .catch((err) => console.log('Failed to fetch exchange rates:', err));
  }, []);

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
        getMobileSummary({
          period: periodKey,
          siteIds: selectedSiteIds,
          currency: null,
          ...(periodKey === 'custom' && customRangeForApi
            ? { since: customRangeForApi.since, until: customRangeForApi.until }
            : {}),
        }),
        getSites(),
      ]);
      setSummary(sum);
      setSites(siteList);
      setPurchasesPage(1);
      setHasMorePurchases(sum.recentPurchases.length >= 50);
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
  }, [periodKey, customRangeForApi, selectedSiteIds, handleAuthFailure]);

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

  const loadMorePurchases = useCallback(async () => {
    if (loadingMore || !hasMorePurchases) return;
    setLoadingMore(true);
    try {
      const next = purchasesPage + 1;
      const { getMobilePurchases } = await import('./api');
      const newList = await getMobilePurchases({
        period: periodKey,
        siteIds: selectedSiteIds,
        currency: null,
        ...(periodKey === 'custom' && customRangeForApi
          ? { since: customRangeForApi.since, until: customRangeForApi.until }
          : {}),
        page: next,
      });

      if (newList.length < 50) setHasMorePurchases(false);
      
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          recentPurchases: [...prev.recentPurchases, ...newList],
        };
      });
      setPurchasesPage(next);
    } catch (e) {
      console.log('Failed to load more purchases', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMorePurchases, purchasesPage, periodKey, selectedSiteIds, customRangeForApi]);



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

  const periodSummaryLabel = useMemo(() => {
    if (periodKey === 'custom' && customRangeForApi) {
      return `${ymdToBr(customRangeForApi.since)} – ${ymdToBr(customRangeForApi.until)}`;
    }
    return PERIOD_PRESETS.find((p) => p.key === periodKey)?.label ?? 'Período';
  }, [periodKey, customRangeForApi]);

  const openPeriodModal = () => {
    setPeriodModalStep('list');
    setPeriodModalVisible(true);
  };

  const closePeriodModal = () => {
    setPeriodModalVisible(false);
    setPeriodModalStep('list');
    setShowSincePicker(false);
    setShowUntilPicker(false);
  };

  const onSelectPresetPeriod = (key: string) => {
    setPeriodKey(key);
    closePeriodModal();
  };

  const onApplyCustomPeriod = () => {
    const { since, until } = clampCustomRange(customSince, customUntil);
    setCustomSince(since);
    setCustomUntil(until);
    setPeriodKey('custom');
    closePeriodModal();
  };

  /** Espaço inferior do sheet: barra de navegação + folga para tocar sem acionar gestos do sistema */
  const periodSheetBottomPad = Math.max(insets.bottom, 18) + 22;
  
  const chartSectionLabel = activeCarouselIndex === 0 ? 'Receita por dia · BRL' : 'Receita por dia · USD (Convertido)';

  const brlSales = summary?.revenueByCurrency.find(c => c.currency === 'BRL')?.sales ?? 0;
  const brlRevenue = summary?.revenueByCurrency.find(c => c.currency === 'BRL')?.revenue ?? 0;

  const usdStats = useMemo(() => {
    let sales = 0;
    let rev = 0;
    if (summary?.revenueByCurrency) {
      summary.revenueByCurrency.filter(c => c.currency !== 'BRL').forEach(c => {
        sales += c.sales;
        if (c.currency === 'USD') {
          rev += c.revenue;
        } else {
          const rate = exchangeRates[c.currency] || null;
          if (rate) {
            rev += (c.revenue / rate);
          }
        }
      });
    }
    return { sales, revenue: rev };
  }, [summary, exchangeRates]);

  let carouselWidth = Dimensions.get('window').width - 36;
  if (carouselWidth < 200) carouselWidth = 300;

  if (loading) {
    return (
      <SafeAreaProvider>
        <LinearGradient colors={[C.bg, '#0a0f1a']} style={styles.centered}>
          <ActivityIndicator size="large" color={C.accent} />
          <StatusBar style="light" />
        </LinearGradient>
      </SafeAreaProvider>
    );
  }

  if (!authToken) {
    return (
      <SafeAreaProvider>
        <LinearGradient colors={['#020408', '#0c1222', '#080c14']} style={styles.loginGradient}>
          <View style={styles.loginBlob1} pointerEvents="none" />
          <View style={styles.loginBlob2} pointerEvents="none" />
          <SafeAreaView style={styles.safeLogin} edges={['top', 'bottom']}>
            <StatusBar style="light" />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.keyboardView}
            >
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginScroll}>
                <View style={styles.loginCard}>
                  <LinearGradient
                    colors={['rgba(56,189,248,0.25)', 'rgba(59,130,246,0.15)', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.loginCardGlow}
                  />
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
                    <Ionicons name="mail-outline" size={20} color={C.textDim} style={styles.inputIcon} />
          <TextInput
                      style={styles.inputInner}
                      placeholder="seu@email.com"
                      placeholderTextColor="#52525b"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
                      autoComplete="email"
                      selectionColor={C.accent}
          />
                  </View>

                  <Text style={styles.fieldLabel}>Senha</Text>
                  <View style={styles.inputWrap}>
                    <Ionicons name="lock-closed-outline" size={20} color={C.textDim} style={styles.inputIcon} />
          <TextInput
                      style={styles.inputInner}
                      placeholder="••••••••"
                      placeholderTextColor="#52525b"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
                      autoComplete="password"
                      selectionColor={C.accent}
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
                      colors={[C.accentDeep, '#2563eb', '#38bdf8']}
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
      <View style={styles.appGradient}>

        <SafeAreaView style={styles.container} edges={['top']}>
          <StatusBar style="light" />
      <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerLogoRing}>
                <Image source={require('./assets/icon.png')} style={styles.headerLogo} resizeMode="contain" accessibilityLabel="Trajettu" />
              </View>
              <View style={styles.headerTextCol}>
                <Text style={styles.brandSmall}>Trajettu</Text>
                <Text style={styles.brandSub} numberOfLines={1}>
                  Painel mobile de vendas em tempo real
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onLogout} style={styles.logoutPill} activeOpacity={0.8} hitSlop={8}>
          <Ionicons name="exit-outline" size={15} color={C.accent} />
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 64 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor="#121826"
            />
          }
        >
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="calendar-outline" size={17} color={C.accent} />
            <Text style={styles.sectionLabel}>Período</Text>
          </View>
          <TouchableOpacity
            style={styles.periodTrigger}
            onPress={openPeriodModal}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Selecionar período"
          >
            <Text style={styles.periodTriggerText} numberOfLines={2}>
              {periodSummaryLabel}
            </Text>
            <Ionicons name="chevron-down" size={22} color={C.textMuted} />
          </TouchableOpacity>

          <Modal
            visible={periodModalVisible}
            transparent
            animationType="fade"
            onRequestClose={closePeriodModal}
          >
            <View style={styles.periodModalRoot}>
              <Pressable style={styles.periodModalBackdrop} onPress={closePeriodModal} />
              <View style={[styles.periodModalSheet, { paddingBottom: periodSheetBottomPad }]}>
                {periodModalStep === 'list' ? (
                  <>
                    <Text style={styles.periodModalTitle}>Período</Text>
                    <ScrollView
                      style={styles.periodModalList}
                      keyboardShouldPersistTaps="handled"
                      contentContainerStyle={styles.periodModalListContent}
                    >
                      {PERIOD_PRESETS.map((p) => {
                        const active = periodKey === p.key;
                        return (
                          <TouchableOpacity
                            key={p.key}
                            style={[styles.periodModalRow, active && styles.periodModalRowActive]}
                            onPress={() => onSelectPresetPeriod(p.key)}
                            activeOpacity={0.85}
                          >
                            <Text style={[styles.periodModalRowText, active && styles.periodModalRowTextActive]}>
                              {p.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[
                          styles.periodModalRow,
                          periodKey === 'custom' && styles.periodModalRowActive,
                        ]}
                        onPress={() => {
                          const c = clampCustomRange(customSince, customUntil);
                          setCustomSince(c.since);
                          setCustomUntil(c.until);
                          setPeriodModalStep('custom');
                        }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            styles.periodModalRowText,
                            periodKey === 'custom' && styles.periodModalRowTextActive,
                          ]}
                        >
                          Período personalizado
                        </Text>
                      </TouchableOpacity>
                    </ScrollView>
                  </>
                ) : (
                  <>
                    <View style={styles.periodCustomHeader}>
                      <TouchableOpacity
                        onPress={() => setPeriodModalStep('list')}
                        hitSlop={12}
                        accessibilityLabel="Voltar"
                      >
                        <Ionicons name="arrow-back" size={24} color={C.text} />
                      </TouchableOpacity>
                      <Text style={styles.periodModalTitleInline}>Datas</Text>
                      <View style={{ width: 24 }} />
                    </View>
                    <Text style={styles.periodCustomHint}>Escolha o intervalo (início e fim do dia).</Text>
                    <View style={styles.periodCustomField}>
                      <Text style={styles.periodCustomLabel}>De</Text>
                      {Platform.OS === 'ios' ? (
                        <DateTimePicker
                          value={parseYmdToDate(customSince)}
                          mode="date"
                          display="compact"
                          themeVariant="dark"
                          onChange={(_, d) => d && setCustomSince(toYmd(d))}
                          maximumDate={parseYmdToDate(customUntil)}
                        />
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.periodAndroidDateBtn}
                            onPress={() => setShowSincePicker(true)}
                          >
                            <Text style={styles.periodAndroidDateBtnText}>{ymdToBr(customSince)}</Text>
                          </TouchableOpacity>
                          {showSincePicker ? (
                            <DateTimePicker
                              value={parseYmdToDate(customSince)}
                              mode="date"
                              display="default"
                              onChange={(e, d) => {
                                setShowSincePicker(false);
                                if (e.type === 'set' && d) setCustomSince(toYmd(d));
                              }}
                              maximumDate={parseYmdToDate(customUntil)}
                            />
                          ) : null}
                        </>
                      )}
                    </View>
                    <View style={styles.periodCustomField}>
                      <Text style={styles.periodCustomLabel}>Até</Text>
                      {Platform.OS === 'ios' ? (
                        <DateTimePicker
                          value={parseYmdToDate(customUntil)}
                          mode="date"
                          display="compact"
                          themeVariant="dark"
                          onChange={(_, d) => d && setCustomUntil(toYmd(d))}
                          minimumDate={parseYmdToDate(customSince)}
                          maximumDate={new Date()}
                        />
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.periodAndroidDateBtn}
                            onPress={() => setShowUntilPicker(true)}
                          >
                            <Text style={styles.periodAndroidDateBtnText}>{ymdToBr(customUntil)}</Text>
                          </TouchableOpacity>
                          {showUntilPicker ? (
                            <DateTimePicker
                              value={parseYmdToDate(customUntil)}
                              mode="date"
                              display="default"
                              onChange={(e, d) => {
                                setShowUntilPicker(false);
                                if (e.type === 'set' && d) setCustomUntil(toYmd(d));
                              }}
                              minimumDate={parseYmdToDate(customSince)}
                              maximumDate={new Date()}
                            />
                          ) : null}
                        </>
                      )}
                    </View>
                    <TouchableOpacity style={styles.periodApplyBtn} onPress={onApplyCustomPeriod} activeOpacity={0.9}>
                      <Text style={styles.periodApplyBtnText}>Aplicar</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </Modal>

          {dataLoading && !summary ? (
            <ActivityIndicator size="large" color={C.accent} style={styles.loader} />
        ) : summary ? (
          <>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="stats-chart-outline" size={17} color={C.accent} />
                <Text style={styles.sectionLabel}>Resumo · {periodSummaryLabel}</Text>
              </View>
              
              <View style={{ marginBottom: 16 }}>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const offset = e.nativeEvent.contentOffset.x;
                    const index = Math.round(offset / carouselWidth);
                    setActiveCarouselIndex(index);
                  }}
                >
                  <View style={{ width: carouselWidth, paddingHorizontal: 4 }}>
                    <View style={styles.unifiedCard}>
                      <View style={styles.unifiedCardSection}>
                        <View style={styles.unifiedCardTop}>
                          <View style={styles.statIconBg}>
                            <Ionicons name="bag-handle-outline" size={18} color={C.accent} />
                          </View>
                          <Text style={styles.statLabel}>Vendas (BRL)</Text>
                        </View>
                        <Text style={styles.statValue}>{brlSales}</Text>
                      </View>
                      <View style={styles.unifiedCardDivider} />
                      <View style={styles.unifiedCardSection}>
                        <View style={styles.unifiedCardTop}>
                          <View style={[styles.statIconBg, styles.statIconBgPurple]}>
                            <Ionicons name="cash-outline" size={18} color={C.purple} />
                          </View>
                          <Text style={styles.statLabel}>Receita (BRL)</Text>
                        </View>
                        <Text style={styles.statValue}>{formatCurrencySafe(brlRevenue, 'BRL')}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={{ width: carouselWidth, paddingHorizontal: 4 }}>
                    <View style={styles.unifiedCard}>
                      <View style={styles.unifiedCardSection}>
                        <View style={styles.unifiedCardTop}>
                          <View style={styles.statIconBg}>
                            <Ionicons name="bag-handle-outline" size={18} color={C.accent} />
                          </View>
                          <Text style={styles.statLabel}>Vendas (USD + Outras)</Text>
                        </View>
                        <Text style={styles.statValue}>{usdStats.sales}</Text>
                      </View>
                      <View style={styles.unifiedCardDivider} />
                      <View style={styles.unifiedCardSection}>
                        <View style={styles.unifiedCardTop}>
                          <View style={[styles.statIconBg, styles.statIconBgPurple]}>
                            <Ionicons name="cash-outline" size={18} color={C.purple} />
                          </View>
                          <Text style={styles.statLabel}>Receita Conversão (USD)</Text>
                        </View>
                        <Text style={styles.statValue}>{formatCurrencySafe(usdStats.revenue, 'USD')}</Text>
                      </View>
                    </View>
                  </View>
                </ScrollView>

                <View style={styles.carouselDots}>
                  <View style={[styles.carouselDot, activeCarouselIndex === 0 && styles.carouselDotActive]} />
                  <View style={[styles.carouselDot, activeCarouselIndex === 1 && styles.carouselDotActive]} />
                </View>
              </View>

              <View style={styles.inlineMeta}>
                <Ionicons name="layers-outline" size={14} color={C.textDim} style={{ marginRight: 6 }} />
                <Text style={styles.inlineMetaText}>
                  {Math.max(sites.length, summary.sitesCount)} site
                  {Math.max(sites.length, summary.sitesCount) === 1 ? '' : 's'} na conta
                </Text>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Ionicons name="trending-up-outline" size={17} color={C.accent} />
                <Text style={styles.sectionLabel}>{chartSectionLabel}</Text>
              </View>
              <View style={styles.chartCard}>
                <SalesChart
                  points={summary.chart}
                  currency={activeCarouselIndex === 0 ? 'BRL' : 'USD'}
                />
              </View>

              {sites.length > 0 ? (
                <View style={{ marginTop: 8 }}>
                  <DropdownPicker
                    label="Site"
                    icon="globe-outline"
                    value={selectedSiteIds.length === 1 ? String(selectedSiteIds[0]) : null}
                    allowClear={true}
                    clearLabel="Todos os sites"
                    options={sites.map(s => ({ key: String(s.id), label: s.name }))}
                    onChange={(val) => {
                      if (val === null) setSelectedSiteIds([]);
                      else setSelectedSiteIds([Number(val)]);
                    }}
                  />
                </View>
              ) : null}

              <View style={styles.sectionHeaderRow}>
                <Ionicons name="receipt-outline" size={17} color={C.accent} />
                <Text style={styles.sectionLabel}>Últimas vendas</Text>
              </View>
            {summary.recentPurchases.length === 0 ? (
                <Text style={styles.empty}>
                  Nenhuma venda neste período com os filtros atuais.
                </Text>
            ) : (
              <View>
                {summary.recentPurchases.map((p, idx) => (
                  <View key={`${p.id}-${idx}`} style={styles.row}>
                    <View style={styles.rowLeading}>
                      <Ionicons name="flash-outline" size={18} color={C.accent} />
                    </View>
                    <View style={styles.rowLeft}>
                        <View style={styles.rowTop}>
                      <Text style={styles.rowOrder}>#{p.orderId}</Text>
                        {(() => {
                          const pf = (p.platform || '').toLowerCase();
                          let bg = 'rgba(56, 189, 248, 0.1)';
                          let border = 'rgba(56, 189, 248, 0.24)';
                          let text = C.accent;
                          if (pf === 'hotmart') {
                            bg = 'rgba(249, 115, 22, 0.1)';
                            border = 'rgba(249, 115, 22, 0.24)';
                            text = '#fdba74';
                          } else if (pf === 'kiwify') {
                            bg = 'rgba(59, 130, 246, 0.1)';
                            border = 'rgba(59, 130, 246, 0.24)';
                            text = '#93c5fd';
                          } else if (pf === 'eduzz') {
                            bg = 'rgba(234, 179, 8, 0.1)';
                            border = 'rgba(234, 179, 8, 0.24)';
                            text = '#fde047';
                          }
                          return (
                            <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
                              <Text style={[styles.badgeText, { color: text }]}>{formatPlatform(p.platform)}</Text>
                            </View>
                          );
                        })()}
                        </View>
                      <Text style={styles.rowSite}>{p.siteName}</Text>
                      <Text style={styles.rowDate}>{formatDate(p.createdAt)}</Text>
                    </View>
                    <View style={styles.rowAmountWrap}>
                      <Text style={styles.rowAmount}>
                        {p.amount != null ? formatCurrencySafe(p.amount, p.currency) : '—'}
                      </Text>
                      <Text style={styles.rowCurrency}>{formatCurrencyLabel(p.currency)}</Text>
                    </View>
                  </View>
                ))}
                
                {hasMorePurchases && (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={loadMorePurchases}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <ActivityIndicator color={C.accent} />
                    ) : (
                      <Text style={styles.loadMoreBtnText}>Carregar mais</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        ) : (
          <Text style={styles.empty}>Não foi possível carregar os dados.</Text>
        )}
      </ScrollView>
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const chartStyles = StyleSheet.create({
  chartOuter: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  chartInner: {
    width: '100%',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yAxis: {
    width: 56,
    justifyContent: 'space-between',
    paddingRight: 6,
  },
  yTick: {
    fontSize: 10,
    color: C.textDim,
    textAlign: 'right',
    width: '100%',
  },
  chartScroll: {
    flex: 1,
    minWidth: 0,
  },
  xLabels: {
    flexDirection: 'row',
    marginTop: 8,
    paddingHorizontal: 0,
  },
  xTick: {
    flex: 1,
    fontSize: 11,
    color: C.textDim,
    textAlign: 'center',
    fontWeight: '500',
  },
  emptyChart: { padding: 22, alignItems: 'center' },
  emptyChartText: { color: C.textDim, fontSize: 14, textAlign: 'center' },
});

const styles = StyleSheet.create({
  appGradient: { flex: 1, backgroundColor: '#020617' }, // Slate 950 base
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loginGradient: { flex: 1 },
  loginBlob1: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  loginBlob2: {
    position: 'absolute',
    bottom: 40,
    left: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(14, 165, 233, 0.1)',
  },
  safeLogin: { flex: 1 },
  keyboardView: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  loginScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingBottom: 36 },
  loginCard: {
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: C.surface,
    borderRadius: 28,
    padding: 26,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  loginCardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  loginLogo: {
    width: '100%',
    height: 128,
    marginBottom: 28,
    maxWidth: 340,
    alignSelf: 'center',
  },
  welcomeTitle: { fontSize: 24, fontWeight: '800', color: C.text, marginBottom: 6, letterSpacing: -0.3 },
  welcomeSub: { fontSize: 15, color: C.textMuted, marginBottom: 22, lineHeight: 22 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: C.textMuted, marginBottom: 8, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bgElevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    marginBottom: 14,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  inputInner: { flex: 1, paddingVertical: 15, fontSize: 16, color: C.text },
  apiHint: { fontSize: 11, color: C.textDim, marginTop: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: '#fca5a5', marginBottom: 8, fontSize: 14 },
  gradientBtnWrap: { marginTop: 10, borderRadius: 16, overflow: 'hidden' },
  gradientBtn: { paddingVertical: 17, alignItems: 'center', justifyContent: 'center' },
  gradientBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  forgotWrap: { marginTop: 20, alignItems: 'center' },
  forgotText: { fontSize: 14, color: C.textDim },
  forgotLink: { color: C.purple, fontWeight: '700' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: 'rgba(6, 10, 18, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.08)',
  },
  headerLeft: { flex: 1, marginRight: 12, flexDirection: 'row', alignItems: 'center' },
  headerLogoRing: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerLogo: { width: 30, height: 30 },
  headerTextCol: { flex: 1, minWidth: 0, justifyContent: 'center' },
  brandSmall: { fontSize: 17, fontWeight: '800', color: C.text, letterSpacing: -0.2 },
  brandSub: { marginTop: 2, fontSize: 12, color: C.textDim, fontWeight: '600' },
  logoutPill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.09)',
    borderWidth: 1,
    borderColor: C.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoutText: { fontSize: 14, color: C.accent, fontWeight: '700' },
  errorBanner: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(234, 179, 8, 0.3)',
  },
  errorBannerText: { color: '#fde68a', fontSize: 13, marginBottom: 8 },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  retryBtnText: { color: '#fef3c7', fontSize: 13, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 44 },
  loader: { marginTop: 48 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 10 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  periodTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(17, 24, 39, 0.88)',
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 6,
  },
  periodTriggerText: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text, lineHeight: 22 },
  heroCard: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
    elevation: 8,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: C.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.5, lineHeight: 28, maxWidth: 240 },
  heroSubtitle: { marginTop: 12, fontSize: 14, lineHeight: 21, color: C.textMuted },
  heroStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(2, 6, 23, 0.48)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.22)',
  },
  heroStatusText: { fontSize: 12, fontWeight: '800', color: C.accent },
  heroMetaRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  heroMetaCard: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.34)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.08)',
  },
  heroMetaLabel: { fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontWeight: '800' },
  heroMetaValue: { fontSize: 13, color: C.text, fontWeight: '700' },
  periodModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  periodModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  periodModalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    paddingTop: 18,
    paddingHorizontal: 16,
    maxHeight: '78%',
  },
  periodModalTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  periodModalTitleInline: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
  },
  periodModalList: { maxHeight: 360 },
  periodModalListContent: {
    paddingTop: 4,
    paddingBottom: 12,
  },
  periodModalRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  periodModalRowActive: {
    backgroundColor: PERIOD_ROW_SELECTED,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  periodModalRowText: { fontSize: 16, fontWeight: '600', color: C.text },
  periodModalRowTextActive: { color: '#fff' },
  periodCustomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  periodCustomHint: { fontSize: 13, color: C.textDim, marginBottom: 16, lineHeight: 20 },
  periodCustomField: { marginBottom: 16 },
  periodCustomLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  periodAndroidDateBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.bgElevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  periodAndroidDateBtnText: { fontSize: 16, fontWeight: '600', color: C.text },
  periodApplyBtn: {
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: PERIOD_ROW_SELECTED,
    alignItems: 'center',
  },
  periodApplyBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 138,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 6,
  },
  statBoxAccent: { borderLeftWidth: 0, borderColor: 'rgba(34, 211, 238, 0.28)' },
  statBoxAccentPurple: { borderLeftWidth: 0, borderColor: 'rgba(167, 139, 250, 0.26)' },
  statBoxTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  statIconBg: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIconBgPurple: { backgroundColor: 'rgba(167, 139, 250, 0.16)' },
  statLabel: { fontSize: 10, fontWeight: '800', color: C.textDim, textTransform: 'uppercase', letterSpacing: 1.2 },
  statValue: { fontSize: 24, fontWeight: '900', color: C.text, letterSpacing: -0.6, lineHeight: 28 },
  statFootnote: { marginTop: 'auto', fontSize: 12, lineHeight: 18, color: C.textDim },
  
  unifiedCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 6,
  },
  unifiedCardSection: {
    padding: 18,
  },
  unifiedCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 10,
  },
  unifiedCardDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 16,
  },
  carouselDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  carouselDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  carouselDotActive: {
    width: 24,
    backgroundColor: C.accent,
  },
  inlineMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, backgroundColor: 'rgba(15, 23, 42, 0.35)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)' },
  inlineMetaText: { fontSize: 13, color: C.textMuted, fontWeight: '600' },
  chartCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  filterHint: { fontSize: 12, color: C.textDim, marginBottom: 10, lineHeight: 18 },
  siteChips: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 14 },
  siteChip: {
    backgroundColor: 'rgba(15, 23, 42, 0.40)',
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 14,
    margin: 4,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: '100%',
  },
  siteChipActive: {
    borderColor: C.borderStrong,
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
  },
  siteChipName: { fontSize: 14, fontWeight: '700', color: C.text },
  siteChipNameActive: { color: '#ecfeff' },
  siteChipDomain: { fontSize: 11, color: C.textDim, marginTop: 4 },
  empty: { color: C.textMuted, fontSize: 14, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.40)',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
  },
  rowLeading: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 12,
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLeft: { flex: 1, marginRight: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  rowOrder: { fontSize: 15, fontWeight: '800', color: C.text, letterSpacing: -0.2 },
  badge: {
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.24)',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: C.accent },
  rowSite: { fontSize: 13, color: C.textMuted, marginTop: 5, fontWeight: '700' },
  rowDate: { fontSize: 12, color: C.textDim, marginTop: 3 },
  rowAmountWrap: { alignItems: 'flex-end', justifyContent: 'center', maxWidth: 132 },
  rowAmount: { fontSize: 17, fontWeight: '800', color: C.accent, letterSpacing: -0.3, textAlign: 'right' },
  rowCurrency: { marginTop: 4, fontSize: 11, fontWeight: '700', color: C.textDim, textAlign: 'right' },
  loadMoreBtn: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  loadMoreBtnText: {
    color: C.accent,
    fontSize: 15,
    fontWeight: '700',
  },
});
