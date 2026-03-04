import fs from 'fs';
const file = 'c:/Users/victo/Desktop/Trakeamento e Aprendizagem/apps/dashboard/src/pages/Site.tsx';
let content = fs.readFileSync(file, 'utf8');

// replace classes starting with bg-zinc-950
content = content.replace(/className=\"([^"]*?bg-zinc-950[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:')) return match;
    return 'className="' + classes
        .replace(/bg-zinc-950/g, 'bg-white dark:bg-zinc-950')
        .replace(/bg-zinc-900/g, 'bg-zinc-50 dark:bg-zinc-900')
        .replace(/border-zinc-900/g, 'border-zinc-200 dark:border-zinc-900')
        .replace(/border-zinc-800/g, 'border-zinc-200 dark:border-zinc-800')
        .replace(/text-zinc-600/g, 'text-zinc-400 dark:text-zinc-600')
        .replace(/text-zinc-500/g, 'text-zinc-500 dark:text-zinc-400')
        .replace(/text-zinc-400/g, 'text-zinc-600 dark:text-zinc-400')
        .replace(/text-zinc-300/g, 'text-zinc-600 dark:text-zinc-300')
        .replace(/text-zinc-200/g, 'text-zinc-900 dark:text-zinc-200')
        .replace(/text-white/g, 'text-zinc-900 dark:text-white') + '"';
});

// replace remaining cards with bg-zinc-900
content = content.replace(/className=\"([^"]*?bg-zinc-900[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:')) return match;
    return 'className="' + classes
        .replace(/bg-zinc-900/g, 'bg-zinc-50 dark:bg-zinc-900')
        .replace(/bg-zinc-800/g, 'bg-zinc-100 dark:bg-zinc-800')
        .replace(/border-zinc-900/g, 'border-zinc-200 dark:border-zinc-900')
        .replace(/border-zinc-800/g, 'border-zinc-200 dark:border-zinc-800')
        .replace(/border-zinc-700/g, 'border-zinc-300 dark:border-zinc-700')
        .replace(/text-zinc-500/g, 'text-zinc-500 dark:text-zinc-400')
        .replace(/text-zinc-400/g, 'text-zinc-600 dark:text-zinc-400')
        .replace(/text-zinc-100/g, 'text-zinc-900 dark:text-zinc-100') + '"';
});

// clean up shadows which look weird on light
content = content.replace(/shadow-\[0_0_0_1px_rgba\(255,255,255,0\.03\)\]/g, 'shadow-sm dark:shadow-[0_0_0_1px_rgba(255,255,255,0.03)]');

fs.writeFileSync(file, content);
console.log('Done!');
