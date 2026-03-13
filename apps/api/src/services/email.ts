import { Resend } from 'resend';
import { pool } from '../db/pool';

const DEFAULT_APP_URL = process.env.VITE_DASHBOARD_URL || 'https://app.trajettu.com';

export const DEFAULT_WELCOME_SUBJECT = 'Bem-vindo ao Trajettu AI Analytics';
export const DEFAULT_RESET_SUBJECT = 'Recuperação de Senha - Trajettu';

export const DEFAULT_WELCOME_HTML = `
  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    <h1 style="color: #4f46e5;">Bem-vindo ao Trajettu!</h1>
    <p>Olá {{name}},</p>
    <p>Estamos muito felizes em ter você conosco. Sua conta foi criada com sucesso.</p>
    <p>Agora você tem acesso ao poder da inteligência artificial para analisar suas campanhas e otimizar seus resultados.</p>
    <p>Para começar, acesse seu painel:</p>
    <a href="{{app_url}}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Acessar Painel</a>
    <p style="margin-top: 30px; font-size: 12px; color: #666;">Se você tiver alguma dúvida, responda a este e-mail.</p>
  </div>
`;

export const DEFAULT_RESET_HTML = `
  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    <h1 style="color: #4f46e5;">Recuperação de Senha</h1>
    <p>Recebemos uma solicitação para redefinir a senha da sua conta no Trajettu.</p>
    <p>Se você não solicitou isso, pode ignorar este e-mail com segurança.</p>
    <p>Para redefinir sua senha, clique no botão abaixo:</p>
    <a href="{{reset_link}}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Redefinir Senha</a>
    <p style="margin-top: 20px;">Ou copie e cole o link abaixo no seu navegador:</p>
    <p style="color: #666; word-break: break-all;">{{reset_link}}</p>
    <p style="margin-top: 30px; font-size: 12px; color: #666;">Este link expira em 1 hora.</p>
  </div>
`;

type EmailSettings = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  welcomeSubject: string;
  welcomeHtml: string;
  resetSubject: string;
  resetHtml: string;
};

let cachedSettings: EmailSettings | null = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 60_000;

const renderTemplate = (template: string, vars: Record<string, string>): string => {
  return Object.entries(vars).reduce((html, [key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    return html.replace(pattern, value);
  }, template);
};

async function loadEmailSettings(): Promise<EmailSettings> {
  if (cachedSettings && Date.now() - cachedAt < SETTINGS_TTL_MS) {
    return cachedSettings;
  }

  const res = await pool.query(
    `SELECT api_key, from_email, from_name, welcome_subject, welcome_html, reset_subject, reset_html
     FROM email_settings
     WHERE id = 1`
  );

  const row = res.rowCount ? res.rows[0] : {};
  const apiKey: string | null = row.api_key || process.env.RESEND_API_KEY || null;

  if (!apiKey) {
    throw new Error('RESEND API key is not configured. Set RESEND_API_KEY env or configure in email_settings.');
  }

  const useIfRich = (stored: string | null, fallback: string): string =>
    stored && stored.includes('style=') ? stored : fallback;

  const settings: EmailSettings = {
    apiKey,
    fromEmail: row.from_email || 'contato@trajettu.com',
    fromName: row.from_name || 'Trajettu',
    welcomeSubject: row.welcome_subject || DEFAULT_WELCOME_SUBJECT,
    welcomeHtml: useIfRich(row.welcome_html, DEFAULT_WELCOME_HTML),
    resetSubject: row.reset_subject || DEFAULT_RESET_SUBJECT,
    resetHtml: useIfRich(row.reset_html, DEFAULT_RESET_HTML),
  };

  cachedSettings = settings;
  cachedAt = Date.now();
  return settings;
}

export async function sendWelcomeEmail(email: string, name: string) {
  try {
    const settings = await loadEmailSettings();
    const resend = new Resend(settings.apiKey);
    const from = `${settings.fromName} <${settings.fromEmail}>`;
    const html = renderTemplate(settings.welcomeHtml, { name, app_url: DEFAULT_APP_URL });

    const { error } = await resend.emails.send({
      from,
      to: [email],
      subject: settings.welcomeSubject,
      html,
    });

    if (error) {
      console.error('Erro ao enviar email de boas-vindas:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Erro ao enviar email de boas-vindas:', err);
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, resetLink: string) {
  try {
    const settings = await loadEmailSettings();
    const resend = new Resend(settings.apiKey);
    const from = `${settings.fromName} <${settings.fromEmail}>`;
    const html = renderTemplate(settings.resetHtml, { reset_link: resetLink });

    const { error } = await resend.emails.send({
      from,
      to: [email],
      subject: settings.resetSubject,
      html,
    });

    if (error) {
      console.error('Erro ao enviar email de recuperação:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Erro ao enviar email de recuperação:', err);
    return false;
  }
}
