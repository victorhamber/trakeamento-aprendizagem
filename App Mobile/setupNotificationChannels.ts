import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Nome do recurso Android (sem extensão) — deve bater com o ficheiro em assets/sounds (ex.: sale_kaching.mp3). */
export const SALE_SOUND_FILE = 'sale_kaching.mp3';

/**
 * Canal `sales` com som customizado (MP3 incluído no build via app.json).
 * O backend deve enviar push com `channelId: "sales"`.
 */
export async function setupAndroidSalesChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('sales', {
    name: 'Alertas de venda',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    sound: 'sale_kaching',
    enableVibrate: true,
  });
}
