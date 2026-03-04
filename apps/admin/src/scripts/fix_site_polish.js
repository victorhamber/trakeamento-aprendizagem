import fs from 'fs';
const file = 'c:/Users/victo/Desktop/Trakeamento e Aprendizagem/apps/dashboard/src/pages/Site.tsx';
let content = fs.readFileSync(file, 'utf8');

// Patch 900 backgrounds
content = content.replace(/className=\"([^"]*?bg-zinc-900\b[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:bg-zinc-900') || classes.includes('dark:bg-zinc-950')) return match;
    return 'className="' + classes.replace(/bg-zinc-900/g, 'bg-zinc-100 dark:bg-zinc-900') + '"';
});

// Patch 200, 300, 400 texts
content = content.replace(/className=\"([^"]*?text-zinc-(200|300|400)\b[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:text-zinc-200') || classes.includes('dark:text-zinc-300') || classes.includes('dark:text-zinc-400') || classes.includes('dark:text-white')) return match;
    return 'className="' + classes
        .replace(/text-zinc-200/g, 'text-zinc-800 dark:text-zinc-200')
        .replace(/text-zinc-300/g, 'text-zinc-700 dark:text-zinc-300')
        .replace(/text-zinc-400/g, 'text-zinc-500 dark:text-zinc-400') + '"';
});

content = content.replace(/className=\"([^"]*?border-zinc-800\/60\b[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:border-')) return match;
    return 'className="' + classes.replace(/border-zinc-800\/60/g, 'border-zinc-200 dark:border-zinc-800/60') + '"';
});

// Fix unescaped hover variants
content = content.replace(/className=\"([^"]*?hover:text-zinc-300\b[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:hover:text-zinc-300')) return match;
    return 'className="' + classes.replace(/hover:text-zinc-300/g, 'hover:text-zinc-900 dark:hover:text-zinc-300') + '"';
});

content = content.replace(/className=\"([^"]*?hover:bg-zinc-900\/40\b[^"]*?)\"/g, (match, classes) => {
    if (classes.includes('dark:hover:bg-zinc-900\/40')) return match;
    return 'className="' + classes.replace(/hover:bg-zinc-900\/40/g, 'hover:bg-zinc-100 dark:hover:bg-zinc-900/40') + '"';
});

fs.writeFileSync(file, content);
console.log('Final polish done!');
