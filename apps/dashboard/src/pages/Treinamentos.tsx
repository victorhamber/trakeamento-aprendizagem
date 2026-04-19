import { Layout } from '../components/Layout';

const VIDEOS = [
  {
    id: 'mN0tNVKbpkU',
    title: 'Como Instalar e Configurar o Trajeto do Zero | Pixel, UTM, Eventos e Google Analytics',
    href: 'https://www.youtube.com/watch?v=mN0tNVKbpkU',
  },
  {
    id: '3LZP4cg-rXU',
    title: 'Como Configurar Webhook no Trajettu | Hotmart + Integração Personalizada',
    href: 'https://www.youtube.com/watch?v=3LZP4cg-rXU',
  },
] as const;

export const TreinamentosPage = () => {
  return (
    <Layout title="Treinamentos">
      <div className="max-w-4xl space-y-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Passo a passo em vídeo para configurar rastreamento, eventos e integrações no Trajettu.
        </p>

        <div className="space-y-8">
          {VIDEOS.map((v) => (
            <article
              key={v.id}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950/60 overflow-hidden shadow-sm dark:shadow-none"
            >
              <div className="aspect-video w-full bg-zinc-100 dark:bg-zinc-900">
                <iframe
                  title={v.title}
                  src={`https://www.youtube.com/embed/${v.id}`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <div className="p-4 sm:p-5 border-t border-zinc-100 dark:border-zinc-800/80">
                <h2 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-white leading-snug">
                  {v.title}
                </h2>
                <a
                  href={v.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Abrir no YouTube
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Layout>
  );
};
