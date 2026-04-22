import { Layout } from '../components/Layout';
import { NavLink, Navigate, Outlet, useParams } from 'react-router-dom';

export type TreinamentoLesson = {
  slug: string;
  youtubeId: string;
  title: string;
  summary: string;
};

export const TREINAMENTO_LESSONS: TreinamentoLesson[] = [
  {
    slug: 'trajeto-zero-pixel-utm-ga',
    youtubeId: 'mN0tNVKbpkU',
    title: 'Trajeto do zero: Pixel, UTM, eventos e Google Analytics',
    summary: 'Instalação e configuração do rastreamento desde o início.',
  },
  {
    slug: 'webhook-hotmart-trajettu',
    youtubeId: '3LZP4cg-rXU',
    title: 'Webhooks: Hotmart e integração personalizada no Trajettu',
    summary: 'Conecte vendas e plataformas ao painel via webhook.',
  },
  {
    slug: 'integracao-chatgpt-trajettu-relatorios',
    youtubeId: 'nfWu_jS6l30',
    title: 'Integração ChatGPT no Trajettu: Crie sua API e Gere Relatórios Automáticos',
    summary: 'Como criar a API Key, adicionar crédito e conectar a IA para gerar relatórios e diagnósticos automáticos.',
  },
];

export const DEFAULT_LESSON_SLUG = TREINAMENTO_LESSONS[0]!.slug;

/** Painel da aula: player embutido no Trajettu. */
export const TreinamentosLessonPanel = () => {
  const { lessonSlug } = useParams();
  const lesson = TREINAMENTO_LESSONS.find((l) => l.slug === lessonSlug);

  if (!lessonSlug || !lesson) {
    return <Navigate to={`/treinamentos/${DEFAULT_LESSON_SLUG}`} replace />;
  }

  const idx = TREINAMENTO_LESSONS.indexOf(lesson) + 1;
  const embedSrc = `https://www.youtube.com/embed/${lesson.youtubeId}?rel=0`;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 overflow-hidden shadow-sm dark:shadow-none">
      <div className="aspect-video w-full bg-zinc-950">
        <iframe
          key={lesson.slug}
          title={lesson.title}
          src={embedSrc}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <div className="p-5 sm:p-6 border-t border-zinc-100 dark:border-zinc-800/80">
        <div className="inline-flex items-center rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-indigo-950 dark:bg-indigo-500/25 dark:text-indigo-50">
          Aula {idx}
        </div>
        <h2 className="mt-2 text-lg sm:text-xl font-bold text-zinc-900 dark:text-white leading-snug">
          {lesson.title}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{lesson.summary}</p>
      </div>
    </div>
  );
};

/** Área de membros: lista de aulas + player na mesma estrutura. */
export const TreinamentosShell = () => {
  return (
    <Layout title="Treinamentos">
      <div className="max-w-6xl">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Escolha uma aula na lista — o vídeo abre aqui no painel.
        </p>

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 lg:items-start">
          <div className="lg:hidden flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 [scrollbar-width:thin]">
            {TREINAMENTO_LESSONS.map((lesson, i) => (
              <NavLink
                key={lesson.slug}
                to={`/treinamentos/${lesson.slug}`}
                className={({ isActive }) =>
                  `shrink-0 max-w-[85vw] rounded-xl border px-3 py-2.5 text-left transition-colors ${isActive
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-950 dark:border-indigo-400/50 dark:bg-indigo-500/15 dark:text-white'
                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={
                        `inline-flex rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${isActive
                          ? 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white'
                          : 'bg-indigo-100 text-indigo-950 dark:bg-indigo-500/30 dark:text-indigo-50'
                          }`
                      }
                    >
                      Aula {i + 1}
                    </span>
                    <span className="mt-1.5 block text-xs font-medium leading-snug">{lesson.title}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>

          <aside className="hidden lg:block w-72 shrink-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-3">
            <div className="mb-3 rounded-xl border border-indigo-200/80 bg-indigo-50 px-3 py-2.5 dark:border-indigo-400/30 dark:bg-indigo-500/15">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-950 dark:text-indigo-50">
                Curso · Fundamentos
              </span>
            </div>
            <nav className="space-y-1">
              {TREINAMENTO_LESSONS.map((lesson, i) => (
                <NavLink
                  key={lesson.slug}
                  to={`/treinamentos/${lesson.slug}`}
                  className={({ isActive }) =>
                    `block rounded-xl px-3 py-3 text-left transition-all border ${isActive
                      ? 'bg-indigo-50 dark:bg-white/10 border-indigo-200 dark:border-white/10 shadow-sm'
                      : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5'
                      }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={
                          `inline-flex w-fit rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide ${isActive
                            ? 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white'
                            : 'bg-zinc-200 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-50'
                            }`
                        }
                      >
                        Aula {i + 1}
                      </span>
                      <span
                        className={
                          `mt-2 block text-sm font-medium leading-snug ${isActive ? 'text-indigo-950 dark:text-white' : 'text-zinc-900 dark:text-zinc-100'}`
                        }
                      >
                        {lesson.title}
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-500 line-clamp-2">{lesson.summary}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </aside>

          <div className="flex-1 min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </Layout>
  );
};
