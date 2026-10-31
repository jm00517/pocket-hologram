// The ink runtime + compiler, in one place: inkjs 2.3.2 (ink-full: Compiler and Story). The browser gets it from the
// importmap name 'inkjs' (index.html, tools/dev.html: https://cdn.jsdelivr.net/npm/inkjs@2.3.2/dist/ink-full.mjs);
// scripts/story-check.mjs points the same name at .tools/inkjs-2.3.2.mjs. Script.js relies on this exact build's
// behaviour (globalTags, choice tags, JSON shapes): change the version here and in both importmaps together.
export * from 'inkjs';
