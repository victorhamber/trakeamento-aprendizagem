import fs from 'fs';
const file = 'c:/Users/victo/Desktop/Trakeamento e Aprendizagem/apps/dashboard/src/pages/Site.tsx';
let content = fs.readFileSync(file, 'utf8');

// Fix inputCls
content = content.replace(
    /'w-full rounded-lg bg-zinc-900\/60 border border-zinc-800 px-3\.5 py-2\.5 text-sm text-zinc-200 outline-none/g,
    "'w-full rounded-lg bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-200 outline-none"
);

// Fix selectClsCompact
content = content.replace(
    /'rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200 outline-none/g,
    "'rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 outline-none"
);

// Fix selectCls
content = content.replace(
    /'w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3\.5 py-2\.5 text-sm text-zinc-200 outline-none/g,
    "'w-full rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-200 outline-none"
);

// Check if any other input block exists and is missed
content = content.replace(
    /bg-zinc-900\/60 border border-zinc-800 px-3\.5 py-2\.5 text-sm text-zinc-200/g,
    "bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-200"
);

// Aggressive general patch for standalone dark colors that are string literals or hidden in arrays
content = content.replace(/bg-zinc-900\/60/g, 'bg-zinc-100 dark:bg-zinc-900/60');
content = content.replace(/bg-zinc-950/g, 'bg-white dark:bg-zinc-950');
content = content.replace(/border-zinc-800/g, 'border-zinc-200 dark:border-zinc-800');

// Fix "Copiar" button on webhooks tab which might use bg-zinc-800 text-zinc-700
content = content.replace(/bg-zinc-800 hover:bg-zinc-700 text-zinc-700/g, 'bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400');
content = content.replace(/bg-zinc-800 text-zinc-700/g, 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400');

// Fix blue action buttons globally
content = content.replace(/bg-blue-600 hover:bg-blue-500 text-zinc-900/g, 'bg-blue-600 hover:bg-blue-500 text-white');
content = content.replace(/bg-blue-600 hover:bg-blue-700 text-zinc-900/g, 'bg-blue-600 hover:bg-blue-700 text-white');
// General blue button
content = content.replace(/class=\"([^\"]*?bg-blue-600[^\"]*?text-zinc-900[^\"]*?)\"/g, (match, classes) => {
    return 'class="' + classes.replace(/text-zinc-900/g, 'text-white') + '"';
});
content = content.replace(/className=\"([^\"]*?bg-blue-600[^\"]*?text-zinc-900[^\"]*?)\"/g, (match, classes) => {
    return 'className="' + classes.replace(/text-zinc-900/g, 'text-white') + '"';
});
// Remove any text-zinc-900 explicitly in blue buttons if any remaining
content = content.replace(/bg-blue-600 hover:bg-blue-500 text-zinc-900 dark:text-white/g, 'bg-blue-600 hover:bg-blue-500 text-white');

// deduplicate classes from bad regex
content = content.replace(/bg-white dark:bg-white dark:bg-zinc-950/g, 'bg-white dark:bg-zinc-950');
content = content.replace(/bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900\/60/g, 'bg-zinc-100 dark:bg-zinc-900/60');
content = content.replace(/border-zinc-200 dark:border-zinc-200 dark:border-zinc-800/g, 'border-zinc-200 dark:border-zinc-800');
content = content.replace(/text-white dark:text-white/g, 'text-white');

fs.writeFileSync(file, content);
console.log('Final Site.tsx patches applied successfully.');
