import fs from 'fs';
const file = 'c:/Users/victo/Desktop/Trakeamento e Aprendizagem/apps/dashboard/src/pages/Site.tsx';
let content = fs.readFileSync(file, 'utf8');

// Fix text-zinc-900 dark:text-white on blue backgrounds which makes them invisible in light mode
content = content.replace(/text-zinc-900 dark:text-white/g, 'text-white');

// Fix border-white/10
content = content.replace(/border-white\/10/g, 'border-zinc-200 dark:border-white/10');

// Fix text-zinc-500 that might be too light for inputs or code
content = content.replace(/text-zinc-500/g, 'text-zinc-600 dark:text-zinc-500');

// Specific fix for "snippet.js" header bg which is bg-zinc-50 dark:bg-zinc-900/80
// and fix the bg of the code block
content = content.replace(/bg-zinc-950\/60/g, 'bg-white dark:bg-zinc-950/60');
content = content.replace(/bg-zinc-800\/50/g, 'bg-zinc-100 dark:bg-zinc-800/50');
content = content.replace(/bg-zinc-800/g, 'bg-zinc-200 dark:bg-zinc-800');

// Fix text-zinc-300 in code block
content = content.replace(/text-zinc-300/g, 'text-zinc-700 dark:text-zinc-300');


fs.writeFileSync(file, content);
console.log('Site.tsx inputs and buttons patched!');
