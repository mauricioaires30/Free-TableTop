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
    class="win parchment"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    style:z-index={z}
    onpointerdown={onFocus}
    aria-label="Ficha de {sheet.name}"
    style:--accent-hue={sheet.color ?? (owner ? colorFor(owner) : 'var(--accent-2)')}
  >
    <div class="crest" aria-hidden="true"></div>
    <span class="corner tl" aria-hidden="true"></span><span class="corner tr" aria-hidden="true"></span>
    <span class="corner bl" aria-hidden="true"></span><span class="corner br" aria-hidden="true"></span>
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
    width: min(440px, calc(100vw - 24px));
    max-height: calc(100vh - 90px);
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    overflow: hidden;
  }
  /* Fita marcadora com a cor do dono. */
  .crest {
    position: absolute;
    left: 12px;
    top: 0;
    width: 13px;
    height: 30px;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0.18), transparent 40%, rgba(0, 0, 0, 0.18)), var(--accent-hue);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%);
    box-shadow: 0 2px 2px rgba(0, 0, 0, 0.3);
    z-index: 2;
    pointer-events: none;
  }
  /* Cantos desenhados a tinta. */
  .corner {
    position: absolute;
    width: 18px;
    height: 18px;
    border: 1.5px solid rgba(92, 60, 24, 0.55);
    pointer-events: none;
    z-index: 1;
  }
  .corner::after {
    content: '';
    position: absolute;
    width: 5px;
    height: 5px;
    background: rgba(92, 60, 24, 0.55);
    transform: rotate(45deg);
  }
  .tl { top: 5px; left: 5px; border-right: 0; border-bottom: 0; }
  .tr { top: 5px; right: 5px; border-left: 0; border-bottom: 0; }
  .bl { bottom: 5px; left: 5px; border-right: 0; border-top: 0; }
  .br { bottom: 5px; right: 5px; border-left: 0; border-top: 0; }
  .tl::after { top: 3px; left: 3px; }
  .tr::after { top: 3px; right: 3px; }
  .bl::after { bottom: 3px; left: 3px; }
  .br::after { bottom: 3px; right: 3px; }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 12px 8px 32px;
    border-bottom: 1px solid rgba(92, 60, 24, 0.35);
    box-shadow: 0 1px 0 rgba(255, 250, 232, 0.5);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  header :global(.name) {
    flex: 1;
    min-width: 0;
    font-family: 'Cinzel', serif;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: 0.02em;
    color: var(--ink);
    background: transparent;
    border-color: transparent !important;
    padding: 4px 6px;
  }
  header :global(.name:focus) {
    border-bottom: 1px solid #7a2e12 !important;
  }
  .avbtn {
    padding: 0 !important;
    border: 0 !important;
    background: none !important;
    border-radius: 50%;
    position: relative;
    box-shadow: 0 0 0 2px #e9d6ab, 0 0 0 3.5px rgba(70, 44, 14, 0.75), 0 2px 6px rgba(0, 0, 0, 0.35);
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
    background: rgba(40, 24, 8, 0.55);
    border-radius: 50%;
    font-size: 14px;
  }
  .badge {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid rgba(92, 60, 24, 0.45);
    color: var(--muted);
    white-space: nowrap;
    font-family: 'Cinzel', serif;
  }
  .icon {
    padding: 3px 7px;
  }
  .lock {
    font-size: 11px;
    padding: 3px 8px;
    white-space: nowrap;
    border: 1px solid var(--border) !important;
    border-radius: 999px;
  }
  .lock.on {
    border-color: #8b1e1e !important;
    color: #8b1e1e;
  }
  .body {
    overflow-y: auto;
    padding: 12px 16px 14px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
  }
  .full {
    grid-column: 1 / -1;
  }
  /* "~ Atributos ~" com floreio dos dois lados. */
  h4 {
    margin: 8px 0 2px;
    font-family: 'Cinzel', serif;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6b2410;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h4::before,
  h4::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(92, 60, 24, 0.7));
  }
  h4::after {
    background: linear-gradient(90deg, rgba(92, 60, 24, 0.7), transparent);
  }
  .lbl {
    display: block;
    font-size: 13px;
    font-variant: small-caps;
    letter-spacing: 0.03em;
    color: var(--muted);
    margin-bottom: 2px;
    text-align: left;
    padding: 0;
  }
  .roll {
    color: #7a2e12 !important;
    border: 0 !important;
    background: none !important;
    cursor: pointer;
    font-weight: 600;
  }
  .roll:hover {
    text-decoration: underline;
  }
  /* Atributo: caixa desenhada a tinta, com o modificador num selo de cera. */
  .attr {
    background: rgba(255, 250, 232, 0.35);
    border: 1.5px solid rgba(70, 44, 14, 0.7);
    border-radius: 6px 10px 6px 10px;
    box-shadow: inset 0 0 0 3px rgba(255, 250, 232, 0.35), inset 0 0 0 4px rgba(70, 44, 14, 0.22);
    padding: 7px 8px 6px;
    text-align: center;
    position: relative;
    margin-top: 4px;
  }
  .attr .lbl {
    text-align: center;
    width: 100%;
  }
  .attr :global(.big) {
    text-align: center;
    font-family: 'Cinzel', serif;
    font-size: 24px;
    font-weight: 700;
    padding: 0 2px;
    background: transparent !important;
    border-color: transparent !important;
    color: var(--ink);
  }
  .mod {
    position: absolute;
    right: -9px;
    top: -10px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 48% 52% 50% 46%;
    background: radial-gradient(circle at 35% 30%, #c43a2e, #7a1414 72%);
    color: #fbe9d0;
    font-size: 12px;
    font-weight: 700;
    font-family: 'Inter', sans-serif;
    box-shadow: 0 2px 3px rgba(0, 0, 0, 0.4), inset 0 0 0 2px rgba(255, 255, 255, 0.1), inset 0 -2px 3px rgba(0, 0, 0, 0.3);
    transform: rotate(-8deg);
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
    padding: 2px 4px;
    font-weight: 600;
  }
  .tiny {
    padding: 1px 8px;
  }
  .bar {
    height: 10px;
    background: rgba(70, 44, 14, 0.12);
    border: 1px solid rgba(70, 44, 14, 0.55);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 5px;
  }
  .bar div {
    height: 100%;
    transition: width 0.25s;
    filter: saturate(0.85);
    background-image: repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.12) 0 4px, transparent 4px 8px);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .empty-list {
    margin: 0;
    font-size: 13px;
    font-style: italic;
  }
  /* Inventário em linhas pautadas. */
  .row-item {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px dashed rgba(92, 60, 24, 0.4);
    padding: 3px 2px;
  }
  .row-item.equipped::before {
    content: '⚔';
    color: #7a2e12;
    font-size: 13px;
  }
  .row-item :global(.rn) {
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    border-bottom-color: transparent !important;
  }
  .row-item.equipped :global(.rn) {
    font-weight: 600;
  }
  .row-item :global(.rq) {
    width: 44px;
    text-align: center;
    padding: 2px;
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
    padding: 1px 6px;
  }
  .row-extra {
    display: flex;
    gap: 6px;
    padding: 0 4px 3px 14px;
  }
  .row-extra :global(.rnote) {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    font-size: 13px;
    font-style: italic;
  }
  .row-extra :global(.rroll) {
    width: 110px;
    flex: none;
    padding: 1px 4px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
  .add {
    align-self: flex-start;
    font-size: 13px;
    padding: 2px 8px;
    margin-top: 4px;
    font-style: italic;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text);
    font-size: 14px;
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 12px;
    border-top: 1px solid rgba(92, 60, 24, 0.35);
  }
  footer .check {
    font-size: 13px;
    color: var(--muted);
  }
  .pad {
    padding: 16px;
  }
</style>
