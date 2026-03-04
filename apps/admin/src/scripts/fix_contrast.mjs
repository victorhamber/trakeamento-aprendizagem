// fix_contrast.js — Bulk contrast fixes for Site.tsx (multi-theme)
import { readFileSync, writeFileSync } from 'fs';

const filePath = 'src/pages/Site.tsx';
let code = readFileSync(filePath, 'utf8');
let changes = 0;

const replacements = [
    // ── 1. Fix hardcoded section headings (light mode invisible) ──
    // These h3/h4 tags have text-zinc-100 without a dark: variant, making them invisible in light mode
    {
        from: 'font-semibold text-zinc-100"',
        to: 'font-semibold text-zinc-900 dark:text-zinc-100"',
        all: true,
    },
    {
        from: 'font-medium text-zinc-100"',
        to: 'font-medium text-zinc-900 dark:text-zinc-100"',
        all: true,
    },

    // ── 2. Fix border opacity — 800/60 is too faint in dark mode ──
    {
        from: 'dark:border-zinc-800/60',
        to: 'dark:border-zinc-800',
        all: true,
    },

    // ── 3. Fix duplicate/conflicting dark text classes that dilute to zinc-500 ──
    // Pattern: "dark:text-zinc-500 dark:text-zinc-400" → keep only zinc-400
    {
        from: 'dark:text-zinc-500 dark:text-zinc-400',
        to: 'dark:text-zinc-400',
        all: true,
    },
    // Pattern: "dark:text-zinc-700 dark:text-zinc-300" → keep only zinc-300
    {
        from: 'dark:text-zinc-700 dark:text-zinc-300',
        to: 'dark:text-zinc-300',
        all: true,
    },
    // Pattern: "dark:text-zinc-700 dark:text-zinc-600" → keep only zinc-600 
    {
        from: 'dark:text-zinc-700 dark:text-zinc-600',
        to: 'dark:text-zinc-600',
        all: true,
    },
    // Pattern: "dark:text-zinc-500 dark:text-zinc-600" → keep only zinc-500 (the more visible one)
    {
        from: 'dark:text-zinc-500 dark:text-zinc-600',
        to: 'dark:text-zinc-500',
        all: true,
    },

    // ── 4. Fix background double-dark overrides ──
    // "dark:bg-zinc-100 dark:bg-zinc-900/60" → keep dk variant
    {
        from: 'dark:bg-zinc-100 dark:bg-zinc-900/60',
        to: 'dark:bg-zinc-900/60',
        all: true,
    },
    // "dark:bg-zinc-200 dark:bg-zinc-800" → keep dark:bg-zinc-800
    {
        from: 'dark:bg-zinc-200 dark:bg-zinc-800',
        to: 'dark:bg-zinc-800',
        all: true,
    },
    // "dark:bg-zinc-200 dark:bg-zinc-800" variant with hover
    {
        from: 'bg-zinc-200 dark:bg-zinc-200 dark:bg-zinc-800',
        to: 'bg-zinc-200 dark:bg-zinc-800',
        all: true,
    },

    // ── 5. Fix secondary button "Desconectar" / "Testar evento" visibility ──
    // Buttons that use border-zinc-700 background but text-zinc-500 are too dim
    {
        from: 'border-zinc-700 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-700 text-zinc-600 dark:text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:text-zinc-200',
        to: 'border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100',
        all: true,
    },
    // The "Testar evento" button pattern
    {
        from: 'border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:bg-zinc-200 dark:bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 dark:text-zinc-700 dark:text-zinc-300',
        to: 'border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
        all: true,
    },
    // "dark:bg-zinc-50 dark:bg-zinc-900" pattern (remnant double override)
    {
        from: 'hover:bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-200',
        to: 'hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
        all: true,
    },
    // "dark:bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-700 dark:text-zinc-300" (copy buttons)
    {
        from: 'bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-700 dark:text-zinc-300',
        to: 'bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300',
        all: true,
    },

    // ── 6. Ensure "Copiar URL" compact button is consistent ──
    {
        from: 'bg-zinc-200 dark:bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 dark:text-zinc-700 dark:text-zinc-300 px-3 py-1.5 rounded-md',
        to: 'bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 rounded-md',
        all: true,
    },
];

for (const r of replacements) {
    const before = code;
    if (r.all) {
        // escape special regex chars and replace globally
        const escaped = r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        code = code.replace(regex, r.to);
    } else {
        code = code.replace(r.from, r.to);
    }
    if (code !== before) {
        const count = (before.match(new RegExp(r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        console.log(`✓ Replaced ${count}×: "${r.from.slice(0, 60)}..."`);
        changes++;
    } else {
        console.log(`  (no match): "${r.from.slice(0, 60)}..."`);
    }
}

writeFileSync(filePath, code, 'utf8');
console.log(`\n✅ Done — ${changes} patterns applied. File saved.`);
