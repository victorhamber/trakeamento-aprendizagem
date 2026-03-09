import { Resend } from 'resend';

// Inicializa o cliente Resend com a chave fornecida ou variável de ambiente
// O usuário forneceu a chave: re_3bh7VBSK_151DmPwQkbREchZtpKgYafJq
const resend = new Resend(process.env.RESEND_API_KEY || 're_3bh7VBSK_151DmPwQkbREchZtpKgYafJq');

const FROM_EMAIL = 'Trajettu <contato@trajettu.com>';

export async function sendWelcomeEmail(email: string, name: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Bem-vindo ao Trajettu AI Analytics',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #4f46e5;">Bem-vindo ao Trajettu!</h1>
          <p>Olá ${name},</p>
          <p>Estamos muito felizes em ter você conosco. Sua conta foi criada com sucesso.</p>
          <p>Agora você tem acesso ao poder da inteligência artificial para analisar suas campanhas e otimizar seus resultados.</p>
          <p>Para começar, acesse seu painel:</p>
          <a href="https://app.trajettu.com" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Acessar Painel</a>
          <p style="margin-top: 30px; font-size: 12px; color: #666;">Se você tiver alguma dúvida, responda a este e-mail.</p>
        </div>
      `,
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
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Recuperação de Senha - Trajettu',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #4f46e5;">Recuperação de Senha</h1>
          <p>Recebemos uma solicitação para redefinir a senha da sua conta no Trajettu.</p>
          <p>Se você não solicitou isso, pode ignorar este e-mail com segurança.</p>
          <p>Para redefinir sua senha, clique no botão abaixo:</p>
          <a href="${resetLink}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Redefinir Senha</a>
          <p style="margin-top: 20px;">Ou copie e cole o link abaixo no seu navegador:</p>
          <p style="color: #666; word-break: break-all;">${resetLink}</p>
          <p style="margin-top: 30px; font-size: 12px; color: #666;">Este link expira em 1 hora.</p>
        </div>
      `,
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
