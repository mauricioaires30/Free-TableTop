<script lang="ts">
  import { attrModifier, can, colorFor, isResource, numericValue, type FieldValue, type ResourceValue, type TemplateField } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import LiveInput from './LiveInput.svelte';

  let {
    session,
    id,
    index,
    z,
    onFocus,
    onPerm,
  }: {
    session: TableSession;
    id: string;
    index: number;
    z: number;
    onFocus: () => void;
    onPerm?: (id: string) => void;
  } = $props();

  const sheet = $derived(session.docs.sheets[id]);
  const tpl = $derived(sheet ? session.templateOf(sheet) : undefined);
  const editable = $derived(!!sheet && can(session.actor, 'edit', sheet));
  const owner = $derived(sheet?.perm.owner);

  // Posição inicial em cascata; depois o usuário arrasta.
  const start = Math.min(index, 6);
  let pos = $state({ x: 70 + start * 32, y: 70 + start * 28 });
  let priv = $state(false);
  let dragging: { dx: number; dy: number } | null = null;

  function down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button, input')) return;
    dragging = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onFocus();
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    pos = {
      x: Math.max(-300, Math.min(window.innerWidth - 80, e.clientX - dragging.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragging.dy)),
    };
  }
  function up() {
    dragging = null;
  }

  function set(fid: string, v: FieldValue) {
    session.setSheet(id, { [fid]: v });
  }

  function res(fid: string): ResourceValue {
    const v = sheet?.values[fid];
    return isResource(v) ? v : { cur: 0, max: 0 };
  }

  function bump(fid: string, delta: number) {
    const r = res(fid);
    set(fid, { cur: r.cur + delta, max: r.max });
  }

  function roll(f: TemplateField) {
    session.rollSheet(id, f.id, priv);
  }

  const modText = (f: TemplateField) => {
    if (!tpl || tpl.attrMod !== 'd20') return '';
    const m = attrModifier(tpl, numericValue(sheet?.values[f.id]));
    return m >= 0 ? `+${m}` : String(m);
  };
</script>

{#if sheet}
  <section
    class="win"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    style:z-index={z}
    onpointerdown={onFocus}
    aria-label="Ficha de {sheet.name}"
  >
    <header onpointerdown={down} onpointermove={move} onpointerup={up}>
      <span class="dot" style:background={sheet.color ?? (owner ? colorFor(owner) : 'var(--accent-2)')}></span>
      {#if editable}
        <LiveInput class="name" value={sheet.name} maxlength={60} label="Nome" onCommit={(v) => session.setSheet(id, {}, String(v))} />
      {:else}
        <strong class="name">{sheet.name}</strong>
      {/if}
      {#if sheet.kind === 'npc'}<span class="badge">NPC</span>{/if}
      {#if !editable}<span class="badge" title="Você só pode ver esta ficha">só leitura</span>{/if}
      {#if onPerm}
        <button class="ghost icon" title="Permissões da ficha" onclick={() => onPerm(id)}>🔐</button>
      {/if}
      <button class="ghost icon" title="Fechar" aria-label="Fechar" onclick={() => session.closeSheet(id)}>✕</button>
    </header>

    {#if !tpl}
      <p class="muted pad">O modelo desta ficha foi apagado.</p>
    {:else}
      <div class="body">
        {#each tpl.fields as f (f.id)}
          {#if f.type === 'section'}
            <h4 class="full">{f.label}</h4>
          {:else if f.type === 'attr'}
            <div class="attr">
              {#if f.roll}
                <button class="ghost lbl roll" title="Rolar {f.roll}" onclick={() => roll(f)}>🎲 {f.label}</button>
              {:else}
                <span class="lbl">{f.label}</span>
              {/if}
              <LiveInput class="big" type="number" value={numericValue(sheet.values[f.id])} disabled={!editable} label={f.label} onCommit={(v) => set(f.id, Number(v))} />
              {#if modText(f)}<span class="mod">{modText(f)}</span>{/if}
            </div>
          {:else if f.type === 'resource'}
            {@const r = res(f.id)}
            <div class="resource full">
              <div class="row between">
                {#if f.roll}
                  <button class="ghost lbl roll" onclick={() => roll(f)}>🎲 {f.label}</button>
                {:else}
                  <span class="lbl">{f.label}</span>
                {/if}
                <div class="row nums">
                  {#if editable}<button class="ghost tiny" aria-label="Diminuir {f.label}" onclick={() => bump(f.id, -1)}>−</button>{/if}
                  <LiveInput class="num" type="number" value={r.cur} disabled={!editable} label="{f.label} atual" onCommit={(v) => set(f.id, { cur: Number(v), max: r.max })} />
                  <span class="muted">/</span>
                  <LiveInput class="num" type="number" value={r.max} disabled={!editable} label="{f.label} máximo" onCommit={(v) => set(f.id, { cur: r.cur, max: Number(v) })} />
                  {#if editable}<button class="ghost tiny" aria-label="Aumentar {f.label}" onclick={() => bump(f.id, 1)}>+</button>{/if}
                </div>
              </div>
              <div class="bar"><div style:width="{r.max > 0 ? Math.max(0, Math.min(100, (r.cur / r.max) * 100)) : 0}%" style:background={f.color ?? 'var(--accent)'}></div></div>
            </div>
          {:else if f.type === 'check'}
            <label class="check" class:full={f.wide}>
              <input type="checkbox" checked={!!sheet.values[f.id]} disabled={!editable} onchange={(e) => set(f.id, (e.currentTarget as HTMLInputElement).checked)} />
              {f.label}
            </label>
          {:else}
            <div class="field" class:full={f.wide || f.type === 'textarea'}>
              {#if f.roll}
                <button class="ghost lbl roll" onclick={() => roll(f)}>🎲 {f.label}</button>
              {:else}
                <span class="lbl">{f.label}</span>
              {/if}
              <LiveInput
                type={f.type === 'textarea' ? 'textarea' : f.type === 'number' ? 'number' : 'text'}
                rows={4}
                value={f.type === 'number' ? numericValue(sheet.values[f.id]) : String(sheet.values[f.id] ?? '')}
                disabled={!editable}
                label={f.label}
                maxlength={f.type === 'textarea' ? 8000 : 200}
                onCommit={(v) => set(f.id, f.type === 'number' ? Number(v) : String(v))}
              />
            </div>
          {/if}
        {/each}
      </div>
      <footer>
        <label class="check"><input type="checkbox" bind:checked={priv} /> {session.role === 'gm' ? 'Rolagens ocultas' : 'Rolagens só para o mestre'}</label>
        {#if tpl.initiative && editable}
          <button onclick={() => session.rollInitiative(id)}>⚔️ Rolar iniciativa</button>
        {/if}
      </footer>
    {/if}
  </section>
{/if}

<style>
  .win {
    position: fixed;
    width: min(420px, calc(100vw - 24px));
    max-height: calc(100vh - 90px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--border);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  header :global(.name) {
    flex: 1;
    min-width: 0;
    font-family: var(--font-title);
    font-size: 17px;
    background: transparent;
    border-color: transparent;
    padding: 4px 6px;
  }
  header :global(.name:focus) {
    border-color: var(--accent-2);
  }
  .badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--panel-2);
    color: var(--muted);
    white-space: nowrap;
  }
  .icon {
    padding: 3px 7px;
  }
  .body {
    overflow-y: auto;
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .full {
    grid-column: 1 / -1;
  }
  h4 {
    margin: 6px 0 0;
    font-family: var(--font-title);
    font-weight: 400;
    color: var(--accent-2);
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
  }
  .lbl {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 3px;
    text-align: left;
    padding: 0;
  }
  .roll {
    color: var(--accent-2);
    border: 0;
    background: none;
    cursor: pointer;
  }
  .roll:hover {
    text-decoration: underline;
    background: none;
  }
  .attr {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px;
    text-align: center;
    position: relative;
  }
  .attr .lbl {
    text-align: center;
    width: 100%;
  }
  .attr :global(.big) {
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    padding: 2px;
    background: transparent;
    border-color: transparent;
  }
  .mod {
    position: absolute;
    right: 8px;
    bottom: 8px;
    font-size: 12px;
    color: var(--accent-2);
    font-weight: 600;
  }
  .between {
    justify-content: space-between;
  }
  .nums {
    gap: 4px;
  }
  .nums :global(.num) {
    width: 56px;
    text-align: center;
    padding: 4px;
  }
  .tiny {
    padding: 2px 8px;
  }
  .bar {
    height: 8px;
    background: var(--bg);
    border-radius: 99px;
    overflow: hidden;
    margin-top: 6px;
  }
  .bar div {
    height: 100%;
    transition: width 0.25s;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text);
    font-size: 13px;
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
  }
  footer .check {
    font-size: 12px;
    color: var(--muted);
  }
  .pad {
    padding: 16px;
  }
</style>
