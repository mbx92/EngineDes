<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  party: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  building: 'M4 21V7l8-4 8 4v14 M2 21h20 M9 21v-5h6v5 M8 9h1 M15 9h1 M8 12h1 M15 12h1',
  pin: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0 M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  plus: 'M12 5v14 M5 12h14', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'M5 12h14 M13 6l6 6-6 6', chevron: 'M9 5l7 7-7 7',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
  logout: 'M9 4H4v16h5 M9 12h12 M17 8l4 4-4 4',
  // [MBX-5][ORG-001][IAM-001] Consistent settings and reload symbols.
  gear: 'M10 2h4l.6 3 1.4.6 2.5-1.7 2.8 2.8L19.6 9l.6 1.4 1.8.6v2l-1.8.6-.6 1.4 1.7 2.5-2.8 2.8-2.5-1.7-1.4.6L14 22h-4l-.6-3-1.4-.6-2.5 1.7-2.8-2.8L4.4 15l-.6-1.4L2 13v-2l1.8-.6L4.4 9 2.7 6.5l2.8-2.8L8 5.4l1.4-.6z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  refresh: 'M20 4v6h-6 M4 20v-6h6 M4.5 9a8 8 0 0 1 13.2-3L20 10 M4 14l2.3 4a8 8 0 0 0 13.2-3',
  check: 'M5 12l4 4L19 6', close: 'M6 6l12 12 M6 18L18 6',
  leaf: 'M20 4C8 2 3 7 5 14c2 7 13 7 15-10z M5 21l10-12',
  lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
  layers: 'M12 3l10 6-10 6L2 9z M2 13l10 6 10-6 M2 17l10 6 10-6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.grid" /></svg></template>
