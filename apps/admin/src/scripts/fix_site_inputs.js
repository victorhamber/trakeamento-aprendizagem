import fs from 'fs';
const file = 'c:/Users/victo/Desktop/Trakeamento e Aprendizagem/apps/dashboard/src/pages/Site.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace dark text classes that have no light tailwind equivalent yet
content = content.replace(/className=\"([^"]*?text-zinc-600[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:')) return match;
    return 'className="' + classes.replace(/text-zinc-600/g, 'text-zinc-500 dark:text-zinc-600') + '"';
});

content = content.replace(/className=\"([^"]*?text-white[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:')) return match;
    return 'className="' + classes.replace(/text-white/g, 'text-zinc-900 dark:text-white') + '"';
});

// Final pass for remaining backbrounds like bg-zinc-900/60 which are inputs
content = content.replace(/className=\"([^"]*?bg-zinc-900\/60[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:')) return match;
    return 'className="' + classes
        .replace(/bg-zinc-900\/60/g, 'bg-zinc-100 dark:bg-zinc-900/60')
        .replace(/bg-zinc-950/g, 'bg-white dark:bg-zinc-950')
        .replace(/border-zinc-800/g, 'border-zinc-300 dark:border-zinc-800')
        .replace(/text-zinc-400/g, 'text-zinc-600 dark:text-zinc-400')
        .replace(/text-zinc-200/g, 'text-zinc-900 dark:text-zinc-200')
        .replace(/text-white/g, 'text-zinc-900 dark:text-white') + '"';
});

content = content.replace(/className=\"([^"]*?bg-zinc-950\b[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:')) return match;
    return 'className="' + classes
        .replace(/bg-zinc-950/g, 'bg-zinc-50 dark:bg-zinc-950')
        .replace(/border-zinc-800/g, 'border-zinc-200 dark:border-zinc-800') + '"';
});

fs.writeFileSync(file, content);
console.log('Done patching inputs!');
