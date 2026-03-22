import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

/** EAS projectId — obrigatório em builds de produção para o token bater com o projeto do Expo Push. */
export function getEasProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
}

export async function getExpoPushTokenString(): Promise<string | null> {
  const projectId = getEasProjectId();
  const { data } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : {}
  );
  return data ?? null;
}
