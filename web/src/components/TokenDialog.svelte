<script lang="ts">
  import { CONDITIONS, type BoardItem } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';

  let { session, gm = null, item, onClose }: { session: TableSession; gm?: GmSession | null; item: BoardItem; onClose: () => void } = $props();

  const cell = session.map.grid.size || 70;
  let name = $state(item.name ?? '');
  let conditions = $state<string[]>([...(item.conditions ?? [])]);
  let custom = $state('');
  let cells = $state(Math.max(0.5, Math.round((item.w / cell) * 2) / 2));
  let sheetId = $state(item.sheetId ?? '');
  let color = $state(item.color ?? '');
  const linked = $derived(sheetId ? session.docs.sheets[sheetId] : undefined);
  /** Inimigo (ou token sem ficha): a vida fica no próprio token. */
  const ownHp = $derived(!linked || linked.kind === 'monster');
  let hpCur = $state(item.hp?.cur ?? 0);
  let hpMax = $state(item.hp?.max ?? 0);

  const sheets = $derived(Object.values(session.docs.sheets).sort((a, b) => a.name.localeCompare(b.name)));
  /** Condições definidas pelo mestre na aba Mesa. */
  const campaignConditions = $derived(session.settings.conditions ?? CONDITIONS);
  const RINGS = ['', '#c0392b', '#d9a75b', '#4caf7a', '#2e86de', '#8e44ad', '#ebe5d8'];

  function toggle(c: string) {
    conditions = conditions.includes(c) ? conditions.filter((x) => x !== c) : [...conditions, c].slice(0, 12);
  }

  function addCustom() {
    const c = custom.trim().slice(0, 24);
    if (c && !conditions.includes(c)) conditions = [...conditions, c].slice(0, 12);
    custom = '';
  }

  function save() {
    session.edit(item.id, { name: name.trim().slice(0, 40), conditions });
    if (gm) {
      const size = cells * cell;
      gm.updateItem(item.id, {
        sheetId: sheetId || undefined,
        color: color || undefined,
        w: size,
        h: size,
        hp: ownHp && hpMax > 0 ? { cur: Math.min(hpMax, Math.round(hpCur)), max: Math.round(hpMax) } : undefined,
      });
    }
    onClose();
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tok-title">
    <h2 id="tok-title">Token</h2>
    <label for="tn">Nome</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="tn" bind:value={name} maxlength="40" autofocus />

    <label for="c0">Condições</label>
    <div class="conds">
      {#each [...campaignConditions, ...conditions.filter((c) => !campaignConditions.includes(c))] as c, i (c)}
        <button id={i === 0 ? 'c0' : undefined} class="pill" class:on={conditions.includes(c)} onclick={() => toggle(c)}>{c}</button>
      {/each}
    </div>
    <div class="row">
      <input bind:value={custom} placeholder="Outra condição" maxlength="24" onkeydown={(e) => e.key === 'Enter' && addCustom()} />
      <button onclick={addCustom} disabled={!custom.trim()}>Adicionar</button>
    </div>

    {#if gm}
      <div class="grid2">
        <div>
          <label for="tc">Tamanho (células)</label>
          <select id="tc" bind:value={cells}>
            {#each [0.5, 1, 2, 3, 4, 6] as n (n)}<option value={n}>{String(n).replace('.', ',')}</option>{/each}
          </select>
        </div>
        <div>
          <label for="ts">Ficha ligada</label>
          <select id="ts" bind:value={sheetId}>
            <option value="">Nenhuma</option>
            {#each sheets as s (s.id)}<option value={s.id}>{s.name}{s.kind === 'npc' ? ' (NPC)' : s.kind === 'monster' ? ' (inimigo)' : ''}</option>{/each}
          </select>
        </div>
      </div>
      <label for="r0">Cor do anel</label>
      <div class="rings">
        {#each RINGS as c, i (c)}
          <button
            id={i === 0 ? 'r0' : undefined}
            class="ring"
            class:on={color === c}
            style:border-color={c || 'var(--border)'}
            title={c ? c : 'Automática (cor do dono)'}
            aria-label={c ? `Cor ${c}` : 'Cor automática'}
            onclick={() => (color = c)}>{c ? '' : 'A'}</button
          >
        {/each}
      </div>
      {#if ownHp}
        <label for="hpc">Vida deste token</label>
        <div class="row hp">
          <button class="ghost" onclick={() => (hpCur = Math.max(-999, hpCur - 1))} aria-label="Menos vida">−</button>
          <input id="hpc" type="number" bind:value={hpCur} aria-label="Vida atual" />
          <span>/</span>
          <input type="number" min="0" bind:value={hpMax} aria-label="Vida máxima" />
          <button class="ghost" onclick={() => (hpCur = Math.min(hpMax, hpCur + 1))} aria-label="Mais vida">+</button>
        </div>
        <p class="muted small">Cada token de inimigo tem a própria vida (a ficha dá os atributos e as rolagens).</p>
      {:else}
        <p class="muted small">A vida do token vem da barra de vida da ficha ligada.</p>
      {/if}
    {/if}

    <div class="actions">
      <button class="ghost" onclick={onClose}>Cancelar</button>
      <button class="primary" onclick={save}>Salvar</button>
    </div>
  </div>
</div>

<style>
  .conds {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 8px;
  }
  .pill {
    padding: 3px 9px;
    font-size: 12px;
    border-radius: 999px;
  }
  .pill.on {
    background: #6b1d1d;
    border-color: #a33;
    color: #ffe1e1;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 12px;
  }
  .rings {
    display: flex;
    gap: 6px;
  }
  .ring {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border-width: 4px;
    padding: 0;
    font-size: 11px;
    color: var(--muted);
  }
  .ring.on {
    box-shadow: 0 0 0 2px var(--accent-2);
  }
  .small {
    font-size: 12px;
  }
  .hp {
    align-items: center;
  }
  .hp input {
    width: 72px;
  }
</style>
