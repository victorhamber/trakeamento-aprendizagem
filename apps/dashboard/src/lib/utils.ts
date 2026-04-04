import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fuso usado no painel — usa o timezone do navegador do usuário. */
const DASHBOARD_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

/** O servidor roda com TZ=America/Sao_Paulo. Timestamps sem offset são nesse fuso. */
const SERVER_TZ_OFFSET = "-03:00";

/**
 * Formata instante vindo da API/Postgres no fuso local do navegador.
 * - Strings com offset (Z, +00:00, etc.) são usadas como estão.
 * - Strings SEM offset são tratadas como horário do servidor (São Paulo, -03:00).
 */
export function formatDateTimeBrt(input: string | Date | null | undefined): string {
  if (input == null || input === "") return "—";
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return "—";
    return input.toLocaleString("pt-BR", {
      timeZone: DASHBOARD_TZ,
      dateStyle: "short",
      timeStyle: "medium",
    });
  }
  let s = String(input).trim();
  if (!s) return "—";
  const hasOffset = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T");
    s += SERVER_TZ_OFFSET;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString("pt-BR", {
    timeZone: DASHBOARD_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  });
}

