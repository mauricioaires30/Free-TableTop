<script lang="ts" module>
  // Ícones desenhados no estilo "gravado a buril": traço só, cor do texto, com sombra de relevo.
  export const ICONS = {
    hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.5a6 6 0 0 1-5-2.7L4 15.5a1.6 1.6 0 0 1 2.6-1.9L8 15.5',
    ruler: 'M3 17 17 3l4 4L7 21ZM7 13l2 2M10 10l2 2M13 7l2 2M5.5 14.5l1 1M8.5 11.5l1 1M11.5 8.5l1 1',
    pin: 'M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    fog: 'M6.5 14a4 4 0 0 1 .4-8A5 5 0 0 1 16.4 7a3.5 3.5 0 0 1 1.4 7ZM3 17.5h13M7 20.5h14',
    chat: 'M4 4.5h16v11H10l-5 4.5v-4.5H4ZM8 9h8M8 12h5',
    scroll: 'M7 4h11a2 2 0 0 1 2 2v1h-4M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10v1a2 2 0 0 0 2 2M7 4a2 2 0 0 0-2 2v11M8.5 9h4.5M8.5 12h4.5',
    swords: 'M4 4h3l10 10-3 3L4 7ZM20 4h-3l-5 5M15 12l5-5V4M6.5 16.5 4 19l1 1 2.5-2.5M17.5 16.5 20 19l-1 1-2.5-2.5M8 14l2 2M16 14l-2 2',
    book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5ZM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8M8 10h5',
    group: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M15.5 4.3a3.5 3.5 0 0 1 0 6.4M18 13.6a6.5 6.5 0 0 1 3.5 6.4',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    note: 'M5 3h14v12l-6 6H5ZM13 21v-6h6M8 7h8M8 10h6',
    clue: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM21 21l-5.8-5.8M8 9a3 3 0 0 1 3-2',
    image: 'M3 5h18v14H3ZM3 16l5-5 4 4 3-3 6 6M15.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 1v4M12 19v4M1 12h4M19 12h4',
    seal: 'M3 6h18v12H3ZM3 6l9 7 9-7',
    panel: 'M3 4h18v16H3ZM15 4v16',
    d20: 'M12 2 21 7v10l-9 5-9-5V7ZM12 2 7 10h10ZM7 10l5 12 5-12M3 7l4 3M21 7l-4 3M3 17l4-7M21 17l-4-7',
    coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
    lock: 'M5.5 11h13v10h-13ZM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11M12 15v2',
    copy: 'M8 8h12v12H8ZM4 16V4h12',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
    door: 'M5 21V4a1 1 0 0 1 1-1h9v18M15 3l4 2v14l-4 2M12 12h.01M3 21h18',
  } as const;
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name, size = 20, stroke = 1.6 }: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
  class="ico"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={ICONS[name]} /></svg
>

<style>
  .ico {
    flex: none;
    display: block;
    filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.7)) drop-shadow(0 -0.5px 0 rgba(255, 236, 190, 0.18));
  }
</style>
