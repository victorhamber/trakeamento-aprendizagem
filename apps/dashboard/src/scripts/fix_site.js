const fs = require('fs');
const file = 'c:/Users/victo/Desktop/Trakeamento e Aprendizagem/apps/dashboard/src/pages/Site.tsx';
let content = fs.readFileSync(file, 'utf8');

// replace bg-zinc-950/40
content = content.replace(/className=\"([^\"]*?)bg-zinc-950\/40([^\"]*?)\"/g, (match, prefix, suffix) => {
    if (match.includes('dark:')) return match;
    return `className="${prefix}bg-white dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-800/60 shadow-sm dark:shadow-[0_0_0_1px_rgba(255,255,255,0.03)]${suffix}"`
        .replace('border-zinc-900/70', '') // remove old border
        .replace('shadow-[0_0_0_1px_rgba(255,255,255,0.03)]', '') // remove old shadow
        .replace(/\s+/g, ' '); // cleanup spaces
});

// fix text-white
content = content.replace(/className=\"([^\"]*?)text-white([^\"]*?)\"/g, (match, prefix, suffix) => {
    if (match.includes('dark:')) return match;
    return `className="${prefix}text-zinc-900 dark:text-white${suffix}"`;
});

// fix text-zinc-300
content = content.replace(/className=\"([^\"]*?)text-zinc-300([^\"]*?)\"/g, (match, prefix, suffix) => {
    if (match.includes('dark:')) return match;
    return `className="${prefix}text-zinc-600 dark:text-zinc-300${suffix}"`;
});

// fix border-zinc-900/70 and bg-zinc-950/40 for inner cards
content = content.replace(/className=\"([^\"]*?)border-zinc-900\/70([^\"]*?)\"/g, (match, prefix, suffix) => {
    if (match.includes('dark:')) return match;
    return `className="${prefix}border-zinc-100 dark:border-zinc-900/70 bg-zinc-50 dark:bg-zinc-950/40${suffix}"`
        .replace('bg-zinc-950/40', '') // remove old bg
        .replace(/\s+/g, ' '); // cleanup spaces
});

// write back
fs.writeFileSync(file, content);
