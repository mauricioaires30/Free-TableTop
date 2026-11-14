<script lang="ts">
  import type { FogBrush, Tool } from '../lib/board/renderer';
  import type { GmSession } from '../lib/session/gm.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let {
    tool = $bindable('select'),
    fogBrush = $bindable(),
    gm = null,
  }: { tool: Tool; fogBrush: FogBrush; gm?: GmSession | null } = $props();

  const TOOLS: Array<{ id: Tool; icon: IconName; name: string; label: string; hint: string; gmOnly?: boolean }> = [
    { id: 'select', icon: 'hand', name: 'Mover', label: 'Mover e selecionar (V)', hint: '' },
    { id: 'ruler', icon: 'ruler', name: 'Régua', label: 'Régua: arraste para medir (R)', hint: 'Arraste no quadro para medir a distância. Todos veem.' },
    { id: 'ping', icon: 'pin', name: 'Ping', label: 'Ping: clique para chamar atenção (P) · ou Alt+clique', hint: 'Clique no quadro para chamar a atenção de todos.' },
    { id: 'fog', icon: 'fog', name: 'Névoa', label: 'Névoa de guerra (N)', hint: 'Arraste para revelar ou esconder partes do mapa.', gmOnly: true },
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

<div class="palette wood frame" role="toolbar" aria-label="Ferramentas do quadro">
  {#each TOOLS.filter((t) => !t.gmOnly || gm) as t (t.id)}
    <button class:on={tool === t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onclick={() => (tool = t.id)}>
      <span class="ic"><Icon name={t.icon} size={20} /></span>
      <span class="nm">{t.name}</span>
    </button>
  {/each}
</div>

{#if active?.hint}
  <div class="tool-hint parchment" role="status">
    <Icon name={active.icon} size={18} />
    <span><strong>{active.name}:</strong> {active.hint}</span>
    <button class="ghost" onclick={() => (tool = 'select')}>Esc · sair</button>
  </div>
{/if}

{#if tool === 'fog' && gm}
  <div class="fog card leather frame">
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
    gap: 6px;
    padding: 6px 3px;
    z-index: 4;
  }
  .palette button {
    width: 54px;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  /* cada ferramenta é uma moeda de latão */
  .palette .ic {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #e9d3a0;
    background: radial-gradient(circle at 50% 40%, #3a2a1b, #1a120b 75%);
    box-shadow:
      0 0 0 2px #120c07,
      0 0 0 4px #a37a36,
      0 0 0 5px #4a3412,
      0 3px 6px 3px rgba(0, 0, 0, 0.55),
      inset 0 2px 4px rgba(0, 0, 0, 0.7);
    transition: transform 0.12s;
  }
  .palette button:hover .ic {
    transform: translateY(-1px);
    color: #fff1c9;
  }
  .palette .nm {
    font-family: var(--font-fell);
    font-size: 12px;
    color: #bda57d;
  }
  .palette button.on .ic {
    color: #2b1a08;
    background: radial-gradient(circle at 40% 30%, #fff0c2, #d8ab55 45%, #8a5f22 100%);
    box-shadow:
      0 0 0 2px #120c07,
      0 0 0 4px #f0d38c,
      0 0 0 5px #4a3412,
      0 0 14px 4px rgba(240, 200, 120, 0.35),
      inset 0 -2px 3px rgba(0, 0, 0, 0.35);
  }
  .palette button.on .ic :global(.ico) {
    filter: drop-shadow(0 1px 0 rgba(255, 240, 200, 0.7));
  }
  .palette button.on .nm {
    color: #f0d38c;
  }
  .tool-hint {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px 7px 14px;
    border-radius: 3px;
    font-size: 15px;
    color: var(--ink);
    z-index: 4;
    max-width: calc(100% - 180px);
  }
  .tool-hint strong {
    color: #6b2410;
    font-family: 'Cinzel', serif;
  }
  .tool-hint button {
    font-size: 12px;
    padding: 3px 10px;
    white-space: nowrap;
    color: var(--muted);
  }
  .fog {
    position: absolute;
    left: 84px;
    top: 12px;
    width: 240px;
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
