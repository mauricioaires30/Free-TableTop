<script lang="ts">
  import type { TableSession } from '../lib/session/table.svelte';

  // Círculo com a imagem do personagem (ou as iniciais, se não houver imagem).
  let {
    session,
    hash,
    name,
    size = 28,
    color = 'var(--border)',
  }: { session: TableSession; hash?: string; name: string; size?: number; color?: string } = $props();

  let url = $state<string | null>(null);

  $effect(() => {
    const h = hash;
    url = null;
    if (!h) return;
    let alive = true;
    session.images.url(h).then((u) => {
      if (alive) url = u;
    });
    return () => {
      alive = false;
    };
  });

  const initials = $derived(
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
  );
</script>

<span class="av" style:width="{size}px" style:height="{size}px" style:border-color={color} style:font-size="{size * 0.38}px">
  {#if url}
    <img src={url} alt="" />
  {:else}
    {initials || '?'}
  {/if}
</span>

<style>
  .av {
    display: inline-grid;
    place-items: center;
    flex: none;
    border-radius: 50%;
    border: 2px solid;
    background: var(--bg);
    color: var(--text);
    font-weight: 700;
    overflow: hidden;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
