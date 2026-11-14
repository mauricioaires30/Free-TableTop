<script lang="ts" module>
  export interface MenuItem {
    label: string;
    action: () => void;
    danger?: boolean;
    divider?: boolean;
  }
</script>

<script lang="ts">
  let { x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void } = $props();

  let el: HTMLDivElement;
  let pos = $state({ left: x, top: y });

  $effect(() => {
    const r = el.getBoundingClientRect();
    pos = {
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div class="backdrop" role="presentation" onpointerdown={onClose} oncontextmenu={(e) => (e.preventDefault(), onClose())}></div>
<div class="menu" role="menu" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px">
  {#each items as it, i (i)}
    {#if it.divider}<hr />{/if}
    <button
      role="menuitem"
      class:danger={it.danger}
      onclick={() => {
        onClose();
        it.action();
      }}>{it.label}</button
    >
  {/each}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .menu {
    position: fixed;
    z-index: 41;
    min-width: 200px;
    background-color: #241a12;
    background-image: var(--tex-leather), linear-gradient(180deg, #2e2117, #1b130c);
    background-size: 260px 260px, 100% 100%;
    border: 9px solid transparent;
    border-image: var(--frame) 30 / 22px stretch;
    padding: 4px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }
  button {
    text-align: left;
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 7px 10px;
    border-radius: 4px;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 15px;
  }
  button:hover {
    background: var(--metal);
    color: #2b1a08;
    text-shadow: 0 1px 0 rgba(255, 240, 200, 0.5);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 4px 2px;
    width: calc(100% - 4px);
  }
</style>
