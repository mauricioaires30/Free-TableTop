<script lang="ts">
  import type { FogBrush, Tool } from '../lib/board/renderer';
  import type { GmSession } from '../lib/session/gm.svelte';

  let {
    tool = $bindable('select'),
    fogBrush = $bindable(),
    gm = null,
  }: { tool: Tool; fogBrush: FogBrush; gm?: GmSession | null } = $props();

  const TOOLS: Array<{ id: Tool; icon: string; name: string; label: string; hint: string; gmOnly?: boolean }> = [
    { id: 'select', icon: '🖐', name: 'Mover', label: 'Mover e selecionar (V)', hint: '' },
    { id: 'ruler', icon: '📏', name: 'Régua', label: 'Régua: arraste para medir (R)', hint: 'Arraste no quadro para medir a distância. Todos veem.' },
    { id: 'ping', icon: '📍', name: 'Ping', label: 'Ping: clique para chamar atenção (P) · ou Alt+clique', hint: 'Clique no quadro para chamar a atenção de todos.' },
    { id: 'fog', icon: '🌫', name: 'Névoa', label: 'Névoa de guerra (N)', hint: 'Arraste para revelar ou esconder partes do mapa.', gmOnly: true },
  ];
  const active = $derived(TOOLS.find((t) => t.id === tool));

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

<div class="palette wood" role="toolbar" aria-label="Ferramentas do quadro">
  {#each TOOLS.filter((t) => !t.gmOnly || gm) as t (t.id)}
    <button class:on={tool === t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onclick={() => (tool = t.id)}>
      <span class="ic">{t.icon}</span>
      <span class="nm">{t.name}</span>
    </button>
  {/each}
</div>

{#if active?.hint}
  <div class="tool-hint wood" role="status">
    <span>{active.icon} <strong>{active.name}:</strong> {active.hint}</span>
    <button class="ghost" onclick={() => (tool = 'select')}>Esc · sair</button>
  </div>
{/if}

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
    gap: 2px;
    padding: 4px;
    border-radius: 10px;
    z-index: 4;
  }
  .palette button {
    width: 52px;
    height: 48px;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    background: transparent;
    border-color: transparent;
    border-radius: 7px;
  }
  .palette .ic {
    font-size: 18px;
    line-height: 1;
  }
  .palette .nm {
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.02em;
  }
  .palette button.on {
    background: rgba(201, 164, 92, 0.16);
    border-color: var(--brass);
  }
  .palette button.on .nm {
    color: var(--brass);
  }
  .tool-hint {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    z-index: 4;
    max-width: calc(100% - 180px);
  }
  .tool-hint strong {
    color: var(--brass);
  }
  .tool-hint button {
    font-size: 12px;
    padding: 3px 10px;
    white-space: nowrap;
    color: var(--muted);
  }
  .fog {
    position: absolute;
    left: 76px;
    top: 12px;
    width: 230px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 4;
    background: var(--wood);
    border-color: #4a3a28;
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
