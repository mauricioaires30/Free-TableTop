<script lang="ts">
  import { can, colorFor, hpOf, type CombatEntry } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';
  import LiveInput from './LiveInput.svelte';
  import Avatar from './Avatar.svelte';

  let { session, gm = null }: { session: TableSession; gm?: GmSession | null } = $props();

  const c = $derived(session.combat);
  const mine = $derived(session.mySheets());
  const freeSheets = $derived(
    Object.values(session.docs.sheets)
      .filter((s) => !c.entries.some((e) => e.sheetId === s.id))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
  );

  let adding = $state(false);
  let pick = $state<string[]>([]);
  let manualName = $state('');
  let manualInit = $state(10);
  let manualHidden = $state(false);
  let dmg = $state<Record<string, string>>({});

  function sheetOf(e: CombatEntry) {
    return e.sheetId ? session.docs.sheets[e.sheetId] : undefined;
  }

  function hp(e: CombatEntry) {
    const s = sheetOf(e);
    return s ? hpOf(s, session.templateOf(s)) : null;
  }

  function dot(e: CombatEntry) {
    const s = sheetOf(e);
    return s?.perm.owner ? colorFor(s.perm.owner) : s?.kind === 'npc' || !s ? 'var(--accent)' : 'var(--muted)';
  }

  /** Dano (número positivo) ou cura (com +) aplicado na barra de vida da ficha. */
  function applyHp(e: CombatEntry, heal: boolean) {
    const s = sheetOf(e);
    const t = s && session.templateOf(s);
    const v = hp(e);
    const n = Math.abs(parseInt(dmg[e.id] ?? '', 10));
    if (!s || !t?.hpField || !v || !Number.isFinite(n) || n === 0) return;
    session.setSheet(s.id, { [t.hpField]: { cur: Math.min(v.max, v.cur + (heal ? n : -n)), max: v.max } });
    dmg[e.id] = '';
  }

  function addSelected() {
    gm?.combatAddSheets(pick);
    if (manualName.trim()) gm?.combatAddManual(manualName, manualInit, manualHidden);
    pick = [];
    manualName = '';
    adding = false;
  }
</script>

<div class="panel">
  <div class="head">
    {#if c.active}
      <strong class="round">Rodada {c.round}</strong>
    {:else}
      <strong class="muted">{c.entries.length ? 'Combate pausado' : 'Sem combate'}</strong>
    {/if}
    {#if gm}
      <div class="row">
        {#if c.active}
          <button onclick={() => gm.combatStep(-1)} title="Turno anterior" aria-label="Turno anterior">◀</button>
          <button class="primary" onclick={() => gm.combatStep(1)}>Próximo turno ▶</button>
        {:else}
          <button class="primary" onclick={() => gm.combatStart()} disabled={!c.entries.length}>⚔️ Começar</button>
        {/if}
      </div>
    {/if}
  </div>

  {#if mine.length}
    <div class="row wrap mine">
      {#each mine as s (s.id)}
        {#if session.templateOf(s)?.initiative}
          <button onclick={() => session.rollInitiative(s.id)}>🎲 Iniciativa de {s.name}</button>
        {/if}
      {/each}
    </div>
  {/if}

  {#if c.entries.length === 0}
    <p class="muted empty">
      {gm ? 'Adicione fichas ou criaturas e role a iniciativa.' : 'Quando o combate começar, a ordem de turnos aparece aqui.'}
    </p>
  {/if}

  <ol class="list">
    {#each c.entries as e (e.id)}
      {@const h = hp(e)}
      {@const s = sheetOf(e)}
      <li class:current={c.active && c.current === e.id} class:hidden={e.hidden}>
        <div class="line">
          {#if gm}
            <LiveInput class="init" type="number" value={e.init} label="Iniciativa de {e.name}" onCommit={(v) => gm.combatUpdate(e.id, { init: Number(v) })} />
          {:else}
            <span class="init ro">{e.init}</span>
          {/if}
          <Avatar {session} hash={s?.avatar} name={e.name} size={26} color={dot(e)} />
          {#if s}
            <button class="ghost name" onclick={() => session.openSheet(s.id)}>{e.name}</button>
          {:else}
            <span class="name">{e.name}</span>
          {/if}
          {#if e.hidden}<span class="tag" title="Oculto dos jogadores">oculto</span>{/if}
          {#if gm}
            <button class="ghost tiny" title={e.hidden ? 'Mostrar aos jogadores' : 'Ocultar dos jogadores'} onclick={() => gm.combatUpdate(e.id, { hidden: !e.hidden })}>{e.hidden ? '👁' : '🙈'}</button>
            <button class="ghost tiny danger" title="Tirar do combate" onclick={() => gm.combatRemove(e.id)}>✕</button>
          {/if}
        </div>
        {#if h}
          <div class="hpline">
            <div class="bar"><div style:width="{h.max > 0 ? Math.max(0, Math.min(100, (h.cur / h.max) * 100)) : 0}%"></div></div>
            <span class="hpnum">{h.cur}/{h.max}</span>
            {#if s && can(session.actor, 'edit', s)}
              <input class="dmg" inputmode="numeric" placeholder="±" aria-label="Valor de dano ou cura" bind:value={dmg[e.id]} onkeydown={(ev) => ev.key === 'Enter' && applyHp(e, false)} />
              <button class="ghost tiny" title="Causar dano" onclick={() => applyHp(e, false)}>−</button>
              <button class="ghost tiny" title="Curar" onclick={() => applyHp(e, true)}>+</button>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  {#if gm}
    <div class="row wrap tools">
      <button onclick={() => (adding = !adding)}>+ Adicionar</button>
      <button onclick={() => gm.combatRollNpcs()} disabled={!c.entries.length} title="Rola em segredo para NPCs e criaturas">🎲 Iniciativa dos NPCs</button>
      {#if c.active}<button onclick={() => gm.combatEnd()}>Encerrar</button>{/if}
      {#if c.entries.length}<button class="ghost danger" onclick={() => confirm('Limpar a lista de combate?') && gm.combatClear()}>Limpar</button>{/if}
    </div>

    {#if adding}
      <div class="card add">
        {#if freeSheets.length}
          <span class="lbl">Fichas</span>
          <div class="picks">
            {#each freeSheets as s (s.id)}
              <label class="pick">
                <input type="checkbox" checked={pick.includes(s.id)} onchange={() => (pick = pick.includes(s.id) ? pick.filter((x) => x !== s.id) : [...pick, s.id])} />
                {s.name} <span class="muted">{s.kind === 'npc' ? 'NPC' : ''}</span>
              </label>
            {/each}
          </div>
        {/if}
        <span class="lbl">Ou uma criatura avulsa</span>
        <div class="row">
          <input bind:value={manualName} placeholder="Nome (ex.: Goblin 2)" maxlength="40" />
          <input class="small-num" type="number" bind:value={manualInit} aria-label="Iniciativa" />
        </div>
        <label class="pick"><input type="checkbox" bind:checked={manualHidden} /> Oculta dos jogadores</label>
        <div class="row end">
          <button class="ghost" onclick={() => (adding = false)}>Cancelar</button>
          <button class="primary" onclick={addSelected} disabled={!pick.length && !manualName.trim()}>Adicionar</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .panel {
    padding: 12px;
    overflow-y: auto;
    height: 100%;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .round {
    font-family: var(--font-title);
    font-weight: 400;
    font-size: 18px;
    color: var(--accent-2);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .mine {
    margin-bottom: 10px;
  }
  .empty {
    text-align: center;
    margin: 24px 0;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    background: var(--panel-2);
  }
  li.current {
    border-color: var(--accent-2);
    box-shadow: 0 0 0 1px var(--accent-2) inset;
  }
  li.hidden {
    opacity: 0.6;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .line :global(.init) {
    width: 46px;
    text-align: center;
    padding: 4px;
    font-weight: 700;
  }
  .init.ro {
    display: inline-block;
    width: 34px;
    text-align: center;
    font-weight: 700;
    color: var(--accent-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 4px;
  }
  .tag {
    font-size: 11px;
    color: var(--muted);
  }
  .tiny {
    padding: 2px 6px;
  }
  .hpline {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .bar {
    flex: 1;
    height: 7px;
    background: var(--bg);
    border-radius: 99px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.25s;
  }
  .hpnum {
    font-size: 12px;
    color: var(--muted);
    min-width: 46px;
    text-align: right;
  }
  .dmg {
    width: 46px;
    padding: 3px 6px;
    text-align: center;
  }
  .tools {
    margin-top: 12px;
  }
  .add {
    margin-top: 10px;
    padding: 12px;
  }
  .lbl {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin: 6px 0 4px;
  }
  .picks {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow: auto;
  }
  .pick {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 2px 0;
    color: var(--text);
    font-size: 13px;
  }
  .small-num {
    width: 70px;
  }
  .end {
    justify-content: flex-end;
    margin-top: 10px;
  }
</style>
