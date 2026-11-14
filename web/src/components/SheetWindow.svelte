<script lang="ts">
  import {
    attrModifier, attrValue, can, colorFor, isPlayerSheet, isResource, newRowId, numericValue, templateAttrs,
    type FieldValue, type ListRow, type ResourceValue, type TemplateField,
  } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import LiveInput from './LiveInput.svelte';
  import Avatar from './Avatar.svelte';

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
  // Ficha de jogador é do dono: o mestre só vê, a menos que destrave para corrigir.
  let unlocked = $state(false);
  const gmLocked = $derived(!!sheet && session.role === 'gm' && isPlayerSheet(sheet));
  const editable = $derived(!!sheet && can(session.actor, 'edit', sheet) && (!gmLocked || unlocked));
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

  let avatarInput: HTMLInputElement;

  function pickAvatar() {
    const f = avatarInput.files?.[0];
    avatarInput.value = '';
    if (f) void session.setAvatar(id, f);
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

  function listRows(fid: string): ListRow[] {
    const v = sheet?.values[fid];
    return Array.isArray(v) ? (v as ListRow[]) : [];
  }
  function addRow(fid: string) {
    set(fid, [...listRows(fid), { id: newRowId(), name: '' }]);
  }
  function setRow(fid: string, rowId: string, patch: Partial<ListRow>) {
    set(fid, listRows(fid).map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }
  function removeRow(fid: string, rowId: string) {
    set(fid, listRows(fid).filter((r) => r.id !== rowId));
  }

  const modText = (fid: string) => {
    if (!tpl || tpl.attrMod === 'none') return '';
    const m = attrModifier(tpl, attrValue(tpl, sheet?.values[fid]));
    return m >= 0 ? `+${m}` : String(m);
  };

  /** Atributos da campanha que este modelo usa (definidos pelo mestre na aba Mesa). */
  const campaignAttrs = $derived(tpl ? templateAttrs(tpl, session.settings.attributes ?? []) : []);
</script>

{#if sheet}
  <section
    class="win"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    style:z-index={z}
    onpointerdown={onFocus}
    aria-label="Ficha de {sheet.name}"
    style:--accent-hue={sheet.color ?? (owner ? colorFor(owner) : 'var(--accent-2)')}
  >
    <div class="crest" aria-hidden="true"></div>
    <header onpointerdown={down} onpointermove={move} onpointerup={up}>
      <button
        class="avbtn"
        disabled={session.role !== 'gm'}
        title={session.role === 'gm' ? 'Trocar a imagem do personagem' : sheet.name}
        aria-label="Imagem do personagem"
        onclick={() => avatarInput.click()}
      >
        <Avatar {session} hash={sheet.avatar} name={sheet.name} size={36} color={sheet.color ?? (owner ? colorFor(owner) : 'var(--accent-2)')} />
      </button>
      <input type="file" accept="image/*" hidden bind:this={avatarInput} onchange={pickAvatar} />
      {#if editable}
        <LiveInput class="name" value={sheet.name} maxlength={60} label="Nome" onCommit={(v) => session.setSheet(id, {}, String(v))} />
      {:else}
        <strong class="name">{sheet.name}</strong>
      {/if}
      {#if sheet.kind === 'npc'}<span class="badge">NPC</span>{:else if sheet.kind === 'monster'}<span class="badge">Inimigo</span>{/if}
      {#if gmLocked}
        {#if unlocked}
          <button class="ghost lock on" title="Voltar a só ver" onclick={() => (unlocked = false)}>✏️ corrigindo</button>
        {:else}
          <button
            class="ghost lock"
            title="Ficha de {session.nameOf(owner ?? '')}: quem mexe é o jogador. Destrave só para corrigir algo."
            onclick={() => (unlocked = true)}>🔓 Corrigir</button
          >
        {/if}
      {:else if !editable}
        <span class="badge" title="Você só pode ver esta ficha">só leitura</span>
      {/if}
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
              {#if modText(f.id)}<span class="mod">{modText(f.id)}</span>{/if}
            </div>
          {:else if f.type === 'attrs'}
            <h4 class="full">{f.label}</h4>
            {#each campaignAttrs.filter((a) => a.block.id === f.id) as a (a.def.id)}
              <div class="attr">
                {#if f.roll}
                  <button class="ghost lbl roll" title="Rolar {f.roll}" onclick={() => session.rollSheet(id, a.def.id, priv)}>🎲 {a.def.label}</button>
                {:else}
                  <span class="lbl">{a.def.label}</span>
                {/if}
                <LiveInput class="big" type="number" value={attrValue(tpl, sheet.values[a.def.id])} disabled={!editable} label={a.def.label} onCommit={(v) => set(a.def.id, Number(v))} />
                {#if modText(a.def.id)}<span class="mod">{modText(a.def.id)}</span>{/if}
              </div>
            {:else}
              <p class="muted small full">Nenhum atributo escolhido para este modelo.</p>
            {/each}
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
          {:else if f.type === 'list'}
            {@const rows = listRows(f.id)}
            <div class="list full">
              <span class="lbl">{f.label}</span>
              {#if rows.length === 0}
                <p class="muted small empty-list">{editable ? 'Vazio. Use "+ adicionar".' : 'Vazio.'}</p>
              {/if}
              {#each rows as row (row.id)}
                <div class="row-item" class:equipped={row.equipped}>
                  {#if f.showRoll && row.roll}
                    <button class="ghost tiny roll" title="Rolar {row.roll}" onclick={() => session.rollSheet(id, f.id, priv, row.id)}>🎲</button>
                  {/if}
                  <LiveInput
                    class="rn"
                    value={row.name}
                    disabled={!editable}
                    label="Nome do item"
                    maxlength={80}
                    placeholder="nome"
                    onCommit={(v) => setRow(f.id, row.id, { name: String(v) })}
                  />
                  {#if f.showQty}
                    <LiveInput
                      class="rq"
                      type="number"
                      value={row.qty ?? 1}
                      disabled={!editable}
                      label="Quantidade de {row.name || f.label}"
                      onCommit={(v) => setRow(f.id, row.id, { qty: Math.max(0, Number(v)) })}
                    />
                  {/if}
                  {#if f.showEquipped}
                    <label class="eq" title={row.equipped ? 'Equipado' : 'Equipar'}>
                      <input
                        type="checkbox"
                        checked={!!row.equipped}
                        disabled={!editable}
                        onchange={(e) => setRow(f.id, row.id, { equipped: (e.currentTarget as HTMLInputElement).checked })}
                      />
                    </label>
                  {/if}
                  {#if editable}
                    <button class="ghost tiny danger" title="Remover" aria-label="Remover {row.name || 'item'}" onclick={() => removeRow(f.id, row.id)}>✕</button>
                  {/if}
                </div>
                {#if f.showNote || (f.showRoll && editable)}
                  <div class="row-extra">
                    {#if f.showNote}
                      <LiveInput
                        class="rnote"
                        value={row.note ?? ''}
                        disabled={!editable}
                        label="Nota de {row.name || f.label}"
                        maxlength={500}
                        placeholder="nota (opcional)"
                        onCommit={(v) => setRow(f.id, row.id, { note: String(v) })}
                      />
                    {/if}
                    {#if f.showRoll && editable}
                      <LiveInput
                        class="rroll"
                        value={row.roll ?? ''}
                        label="Fórmula de rolagem de {row.name || f.label}"
                        maxlength={100}
                        placeholder="fórmula (ex.: 1d8+2)"
                        onCommit={(v) => setRow(f.id, row.id, { roll: String(v) || undefined })}
                      />
                    {/if}
                  </div>
                {/if}
              {/each}
              {#if editable}
                <button class="ghost small add" onclick={() => addRow(f.id)}>+ adicionar</button>
              {/if}
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
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent-hue) 7%, var(--panel)), var(--panel) 90px);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 0 0 1px color-mix(in srgb, var(--accent-hue) 25%, transparent) inset;
    overflow: hidden;
  }
  .crest {
    height: 4px;
    flex: none;
    background: linear-gradient(90deg, transparent, var(--accent-hue), transparent);
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
  .avbtn {
    padding: 0;
    border: 0;
    background: none;
    border-radius: 50%;
    position: relative;
  }
  .avbtn:disabled {
    opacity: 1;
    cursor: default;
  }
  .avbtn:not(:disabled):hover::after {
    content: '📷';
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    border-radius: 50%;
    font-size: 14px;
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
  .lock {
    font-size: 11px;
    padding: 3px 8px;
    white-space: nowrap;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .lock.on {
    border-color: var(--warn);
    color: var(--warn);
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
    height: 10px;
    background: var(--bg);
    border-radius: 99px;
    overflow: hidden;
    margin-top: 6px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  .bar div {
    height: 100%;
    transition: width 0.25s;
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.35), transparent 55%);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .empty-list {
    margin: 0;
    font-size: 12px;
  }
  .row-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 7px;
  }
  .row-item.equipped {
    border-color: color-mix(in srgb, var(--accent-hue) 55%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-hue) 30%, transparent) inset;
  }
  .row-item :global(.rn) {
    flex: 1;
    min-width: 0;
    padding: 4px 7px;
  }
  .row-item :global(.rq) {
    width: 44px;
    text-align: center;
    padding: 4px;
    flex: none;
  }
  .eq {
    display: flex;
    margin: 0;
    flex: none;
    cursor: pointer;
  }
  .row-item .tiny {
    flex: none;
    padding: 2px 7px;
  }
  .row-extra {
    display: flex;
    gap: 6px;
    padding-left: 4px;
  }
  .row-extra :global(.rnote) {
    flex: 1;
    min-width: 0;
    padding: 3px 7px;
    font-size: 12px;
  }
  .row-extra :global(.rroll) {
    width: 110px;
    flex: none;
    padding: 3px 7px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
  .add {
    align-self: flex-start;
    font-size: 12px;
    padding: 4px 10px;
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
