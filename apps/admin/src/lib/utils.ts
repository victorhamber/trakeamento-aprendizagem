import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DASHBOARD_TZ = "America/Sao_Paulo";

/** Horários da API/DB em pt-BR (São Paulo); timestamps sem fuso vêm como UTC. */
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
    s += s.endsWith("Z") ? "" : "Z";
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString("pt-BR", {
    timeZone: DASHBOARD_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  });
}
