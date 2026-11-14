<script lang="ts">
  import type { FogBrush, Tool } from '../lib/board/renderer';
  import type { GmSession } from '../lib/session/gm.svelte';

  let {
    tool = $bindable('select'),
    fogBrush = $bindable(),
    gm = null,
  }: { tool: Tool; fogBrush: FogBrush; gm?: GmSession | null } = $props();

  const TOOLS: Array<{ id: Tool; icon: string; label: string; gmOnly?: boolean }> = [
    { id: 'select', icon: '🖐', label: 'Mover e selecionar (V)' },
    { id: 'ruler', icon: '📏', label: 'Régua: arraste para medir (R)' },
    { id: 'ping', icon: '📍', label: 'Ping: clique para chamar atenção (P) · ou Alt+clique' },
    { id: 'fog', icon: '🌫', label: 'Névoa de guerra (N)', gmOnly: true },
  ];

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map: Record<string, Tool> = { v: 'select', r: 'ruler', p: 'ping', n: 'fog' };
    const next = map[e.key.toLowerCase()];
    if (next && (next !== 'fog' || gm)) tool = next;
    if (e.key === 'Escape') tool = 'select';
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="palette" role="toolbar" aria-label="Ferramentas do quadro">
  {#each TOOLS.filter((t) => !t.gmOnly || gm) as t (t.id)}
    <button class:on={tool === t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onclick={() => (tool = t.id)}>{t.icon}</button>
  {/each}
</div>

{#if tool === 'fog' && gm}
  <div class="fog card">
    <div class="seg">
      <button class:on={fogBrush.op === 'reveal'} onclick={() => (fogBrush = { ...fogBrush, op: 'reveal' })}>Revelar</button>
      <button class:on={fogBrush.op === 'hide'} onclick={() => (fogBrush = { ...fogBrush, op: 'hide' })}>Esconder</button>
    </div>
    <div class="seg">
      <button class:on={fogBrush.shape === 'rect'} onclick={() => (fogBrush = { ...fogBrush, shape: 'rect' })}>▭ Retângulo</button>
      <button class:on={fogBrush.shape === 'brush'} onclick={() => (fogBrush = { ...fogBrush, shape: 'brush' })}>🖌 Pincel</button>
    </div>
    {#if fogBrush.shape === 'brush'}
      <label class="size">
        Tamanho
        <input type="range" min="15" max="250" value={fogBrush.r} oninput={(e) => (fogBrush = { ...fogBrush, r: Number(e.currentTarget.value) })} />
      </label>
    {/if}
    {#if !gm.map.fog.enabled}
      <p class="warn">A névoa está desligada.</p>
      <button class="primary" onclick={() => gm.setFogEnabled(true)}>Ligar névoa</button>
    {:else}
      <div class="row">
        <button onclick={() => gm.addFog({ op: 'reveal', kind: 'all', pts: [] })}>Revelar tudo</button>
        <button onclick={() => confirm('Cobrir o mapa inteiro de névoa?') && gm.addFog({ op: 'hide', kind: 'all', pts: [] })}>Cobrir tudo</button>
      </div>
      <button class="ghost" onclick={() => gm.setFogEnabled(false)}>Desligar névoa</button>
    {/if}
    <p class="muted hint">Você vê através da névoa; os jogadores não. Para esconder algo de verdade, use também as permissões.</p>
  </div>
{/if}

<style>
  .palette {
    position: absolute;
    left: 12px;
    top: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 4;
  }
  .palette button {
    width: 36px;
    height: 36px;
    padding: 0;
    font-size: 17px;
    background: rgba(22, 25, 32, 0.92);
  }
  .palette button.on {
    border-color: var(--accent-2);
    box-shadow: 0 0 0 1px var(--accent-2) inset;
  }
  .fog {
    position: absolute;
    left: 58px;
    top: 12px;
    width: 230px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 4;
    background: rgba(22, 25, 32, 0.96);
  }
  .seg {
    display: flex;
  }
  .seg button {
    flex: 1;
    border-radius: 0;
    font-size: 12px;
    padding: 6px;
  }
  .seg button:first-child {
    border-radius: 8px 0 0 8px;
  }
  .seg button:last-child {
    border-radius: 0 8px 8px 0;
  }
  .seg button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .size {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row button {
    flex: 1;
    font-size: 12px;
  }
  .warn {
    margin: 0;
    color: var(--warn);
    font-size: 12px;
  }
  .hint {
    margin: 0;
    font-size: 11px;
  }
</style>
