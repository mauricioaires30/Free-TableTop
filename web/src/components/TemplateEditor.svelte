<script lang="ts">
  import {
    calc, FIELD_TYPE_LABELS, fieldIdFromLabel, TEMPLATE_PRESETS,
    type FieldType, type SheetTemplate, type TemplateField,
  } from '@ftt/shared';
  import type { GmSession } from '../lib/session/gm.svelte';
  import { download, safeFileName, templateFromJson, templateToJson } from '../lib/storage/backup';

  let { gm, onClose }: { gm: GmSession; onClose: () => void } = $props();

  const templates = $derived(Object.values(gm.docs.templates).sort((a, b) => a.name.localeCompare(b.name)));
  let selected = $state<string | null>(null);
  let draft = $state<SheetTemplate | null>(null);
  let dirty = $state(false);
  let presetIdx = $state(0);
  /** Campos criados agora: o código acompanha o rótulo até salvar. */
  let fresh = new Set<number>();

  const usage = $derived(
    Object.values(gm.docs.sheets).reduce<Record<string, number>>((acc, s) => ((acc[s.templateId] = (acc[s.templateId] ?? 0) + 1), acc), {}),
  );

  function pick(id: string) {
    if (dirty && !confirm('Descartar as mudanças não salvas?')) return;
    selected = id;
    draft = structuredClone($state.snapshot(gm.docs.templates[id]));
    dirty = false;
    fresh = new Set();
  }

  $effect(() => {
    if (!selected && templates.length) pick(templates[0].id);
  });

  function createFromPreset() {
    const t = gm.createTemplate({ ...TEMPLATE_PRESETS[presetIdx], name: `${TEMPLATE_PRESETS[presetIdx].name} (novo)` });
    dirty = false;
    pick(t.id);
  }

  function change() {
    dirty = true;
  }

  function addField() {
    if (!draft) return;
    const taken = new Set(draft.fields.map((f) => f.id));
    draft.fields.push({ id: fieldIdFromLabel('Novo campo', taken), label: 'Novo campo', type: 'text' });
    fresh.add(draft.fields.length - 1);
    change();
  }

  function relabel(i: number) {
    change();
    if (!draft || !fresh.has(i)) return;
    const taken = new Set(draft.fields.filter((_, j) => j !== i).map((f) => f.id));
    draft.fields[i].id = fieldIdFromLabel(draft.fields[i].label, taken);
  }

  function moveField(i: number, d: -1 | 1) {
    if (!draft) return;
    const j = i + d;
    if (j < 0 || j >= draft.fields.length) return;
    [draft.fields[i], draft.fields[j]] = [draft.fields[j], draft.fields[i]];
    const fi = fresh.has(i);
    const fj = fresh.has(j);
    fresh.delete(i);
    fresh.delete(j);
    if (fi) fresh.add(j);
    if (fj) fresh.add(i);
    change();
  }

  function removeField(i: number) {
    if (!draft) return;
    const f = draft.fields[i];
    if (!confirm(`Remover o campo "${f.label}"? Os valores dele somem das fichas que usam este modelo.`)) return;
    draft.fields.splice(i, 1);
    fresh = new Set([...fresh].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
    if (draft.hpField === f.id) draft.hpField = undefined;
    change();
  }

  function setType(f: TemplateField, t: FieldType) {
    f.type = t;
    if (t === 'resource' && !f.max) f.max = 10;
    if (t === 'list' && f.showNote === undefined) f.showNote = true;
    if (t === 'attrs') {
      f.attrs = campaignAttrs.map((a) => a.id);
      if (!f.roll) f.roll = draft?.attrMod === 'd20' ? '1d20+{mod}' : '1d20+{v}';
      f.wide = true;
    }
    change();
  }

  /** Erro da conta própria do modificador (testada com v = 10). */
  const modError = $derived.by(() => {
    if (draft?.attrMod !== 'custom' || !draft.attrModFormula?.trim()) return '';
    try {
      calc(draft.attrModFormula, { v: 10 });
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  });

  /** Atributos que existem na campanha (aba Mesa). */
  const campaignAttrs = $derived(gm.settings.attributes ?? []);

  function toggleAttr(f: TemplateField, id: string, on: boolean) {
    const current = f.attrs && f.attrs.length ? f.attrs : campaignAttrs.map((a) => a.id);
    f.attrs = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    change();
  }

  function save() {
    if (!draft) return;
    draft.name = draft.name.trim() || 'Modelo';
    if (draft.initiative !== undefined && !draft.initiative.trim()) draft.initiative = undefined;
    for (const f of draft.fields) {
      if (f.roll !== undefined && !f.roll.trim()) delete f.roll;
    }
    gm.saveTemplate(draft);
    dirty = false;
    fresh = new Set();
    gm.toast('Modelo salvo.');
  }

  function remove() {
    if (!draft) return;
    if (!confirm(`Apagar o modelo "${draft.name}"?`)) return;
    if (gm.deleteTemplate(draft.id)) {
      selected = null;
      draft = null;
      dirty = false;
    }
  }

  let importInput: HTMLInputElement;

  function exportTemplate() {
    if (!draft) return;
    download(new Blob([templateToJson(draft)], { type: 'application/json' }), `modelo-${safeFileName(draft.name)}.json`);
  }

  async function importTemplate() {
    const f = importInput.files?.[0];
    importInput.value = '';
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new Error('Arquivo grande demais.');
      const t = gm.createTemplate(templateFromJson(await f.text()));
      dirty = false;
      pick(t.id);
      gm.toast(`Modelo "${t.name}" importado.`);
    } catch (e) {
      gm.toast(e instanceof SyntaxError ? 'Arquivo inválido.' : (e as Error).message, 'error');
    }
  }

  function close() {
    if (dirty && !confirm('Fechar sem salvar as mudanças?')) return;
    onClose();
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && close()} onkeydown={(e) => e.key === 'Escape' && close()}>
  <div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="tpl-title">
    <div class="head">
      <h2 id="tpl-title">Modelos de ficha</h2>
      <button class="ghost" onclick={close} aria-label="Fechar">✕</button>
    </div>
    <p class="muted">O modelo define o sistema da sua mesa: quais campos a ficha tem e o que cada um rola.</p>

    <div class="cols">
      <aside>
        <ul>
          {#each templates as t (t.id)}
            <li><button class:on={t.id === selected} onclick={() => pick(t.id)}>{t.name}<span class="muted"> · {usage[t.id] ?? 0}</span></button></li>
          {/each}
        </ul>
        <label for="pp">Novo a partir de</label>
        <select id="pp" bind:value={presetIdx}>
          {#each TEMPLATE_PRESETS as p, i (p.name)}<option value={i}>{p.name}</option>{/each}
        </select>
        <button class="wide-btn" onclick={createFromPreset}>+ Criar modelo</button>
        <button class="wide-btn" onclick={() => importInput.click()}>Importar de arquivo…</button>
        <input type="file" accept=".json,application/json" hidden bind:this={importInput} onchange={importTemplate} />
      </aside>

      {#if draft}
        <div class="edit">
          <div class="grid2">
            <div>
              <label for="tn">Nome do modelo</label>
              <input id="tn" bind:value={draft.name} oninput={change} maxlength="60" />
            </div>
            <div>
              <label for="tm">Modificador de atributo</label>
              <select id="tm" bind:value={draft.attrMod} onchange={change}>
                <option value="none">Nenhum (usa o valor)</option>
                <option value="d20">Estilo d20: (valor − 10) ÷ 2</option>
                <option value="custom">Conta própria…</option>
              </select>
            </div>
            {#if draft.attrMod === 'custom'}
              <div>
                <label for="tmf">Conta do modificador (v = valor)</label>
                <input
                  id="tmf"
                  value={draft.attrModFormula ?? ''}
                  oninput={(e) => ((draft!.attrModFormula = e.currentTarget.value), change())}
                  placeholder="ex.: floor(v/2), v*5, v-3"
                  class:bad={!!modError}
                />
                {#if modError}<span class="err">{modError}</span>{/if}
              </div>
            {/if}
            <div>
              <label for="tad">Valor inicial dos atributos</label>
              <input
                id="tad"
                type="number"
                value={draft.attrDefault ?? ''}
                placeholder={draft.attrMod === 'd20' ? '10' : '1'}
                oninput={(e) => {
                  const v = e.currentTarget.value.trim();
                  draft!.attrDefault = v === '' ? undefined : Number(v);
                  change();
                }}
              />
            </div>
            <div>
              <label for="ti">Fórmula de iniciativa</label>
              <input id="ti" value={draft.initiative ?? ''} oninput={(e) => ((draft!.initiative = e.currentTarget.value), change())} placeholder="1d20+&#123;des.mod&#125;" />
            </div>
            <div>
              <label for="th">Barra de vida (combate e tokens)</label>
              <select id="th" value={draft.hpField ?? ''} onchange={(e) => ((draft!.hpField = e.currentTarget.value || undefined), change())}>
                <option value="">Nenhuma</option>
                {#each draft.fields.filter((f) => f.type === 'resource') as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
              </select>
            </div>
          </div>

          <h3>Campos</h3>
          <div class="fields">
            {#each draft.fields as f, i (i)}
              <div class="frow">
                <div class="order">
                  <button class="ghost tiny" onclick={() => moveField(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                  <button class="ghost tiny" onclick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1} aria-label="Descer">▼</button>
                </div>
                <input class="flabel" bind:value={f.label} oninput={() => relabel(i)} aria-label="Rótulo" maxlength="40" />
                <select value={f.type} onchange={(e) => setType(f, e.currentTarget.value as FieldType)} aria-label="Tipo">
                  {#each Object.entries(FIELD_TYPE_LABELS).filter(([k]) => k !== 'attr' || f.type === 'attr') as [k, v] (k)}<option value={k}>{v}</option>{/each}
                </select>
                {#if f.type !== 'section' && f.type !== 'check' && f.type !== 'list'}
                  <input class="froll" value={f.roll ?? ''} oninput={(e) => ((f.roll = e.currentTarget.value), change())} placeholder="rolagem (opcional)" aria-label="Fórmula de rolagem" />
                {:else}
                  <span class="froll"></span>
                {/if}
                {#if f.type === 'resource'}
                  <input class="fmax" type="number" value={f.max ?? 10} oninput={(e) => ((f.max = Number(e.currentTarget.value) || 0), change())} aria-label="Máximo inicial" title="Máximo inicial" />
                {:else}
                  <label class="fwide" title="Ocupar a linha inteira"><input type="checkbox" bind:checked={f.wide} onchange={change} />larga</label>
                {/if}
                <code title="Use nas fórmulas">&#123;{f.id}&#125;</code>
                <button class="ghost tiny danger" onclick={() => removeField(i)} aria-label="Remover campo">✕</button>
              </div>
              {#if f.type === 'attrs'}
                <div class="list-cfg">
                  <span class="muted">Usa:</span>
                  {#each campaignAttrs as a (a.id)}
                    <label>
                      <input type="checkbox" checked={!f.attrs?.length || f.attrs.includes(a.id)} onchange={(e) => toggleAttr(f, a.id, e.currentTarget.checked)} />
                      {a.label}
                    </label>
                  {/each}
                  {#if !campaignAttrs.length}<span class="muted">Crie os atributos na aba Mesa.</span>{/if}
                </div>
              {/if}
              {#if f.type === 'list'}
                <div class="list-cfg">
                  <span class="muted">Colunas:</span>
                  <label><input type="checkbox" bind:checked={f.showQty} onchange={change} /> quantidade</label>
                  <label><input type="checkbox" bind:checked={f.showEquipped} onchange={change} /> equipado</label>
                  <label><input type="checkbox" bind:checked={f.showNote} onchange={change} /> nota</label>
                  <label><input type="checkbox" bind:checked={f.showRoll} onchange={change} /> rolagem por item (ex.: dano de uma arma)</label>
                </div>
              {/if}
            {/each}
          </div>
          <button onclick={addField}>+ Adicionar campo</button>

          <details class="help">
            <summary>Como escrever fórmulas</summary>
            <ul class="muted">
              <li><code>&#123;v&#125;</code> valor do campo clicado · <code>&#123;mod&#125;</code> modificador dele</li>
              <li><code>&#123;for&#125;</code>, <code>&#123;for.mod&#125;</code>, <code>&#123;pv.max&#125;</code> qualquer campo pelo código</li>
              <li>Sucessos: <code>&#123;v&#125;d10&gt;=8</code> conta dados com 8+ · rolar abaixo: <code>1d100&lt;=&#123;v&#125;</code> · Fate: <code>4dF+&#123;v&#125;</code> · rerrolar 1: <code>2d6r1</code></li>
              <li>Exemplos: <code>1d20+&#123;mod&#125;</code> · <code>&#123;v&#125;d20kh1</code> (rola tantos d20 quanto o atributo e fica com o maior) · <code>2d6+&#123;for.mod&#125;</code></li>
            </ul>
          </details>

          <div class="actions">
            <button class="ghost danger" onclick={remove}>Apagar modelo</button>
            <button class="ghost" onclick={exportTemplate} title="Baixa o modelo para mandar a outro mestre">Exportar</button>
            <span class="spacer"></span>
            <button class="primary" onclick={save} disabled={!dirty}>{dirty ? 'Salvar modelo' : 'Salvo'}</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .wide {
    width: min(980px, 100%);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .cols {
    display: grid;
    grid-template-columns: 210px 1fr;
    gap: 18px;
  }
  aside ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  aside li button {
    width: 100%;
    text-align: left;
    background: transparent;
    border-color: transparent;
    margin-bottom: 2px;
  }
  aside li button.on {
    background: var(--panel-2);
    border-color: var(--accent);
  }
  .wide-btn {
    width: 100%;
    margin-top: 8px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 12px;
  }
  h3 {
    font-size: 15px;
    margin: 16px 0 8px;
    color: var(--muted);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .frow {
    display: grid;
    grid-template-columns: 26px 1.3fr 1fr 1.2fr 70px auto 28px;
    gap: 6px;
    align-items: center;
  }
  .frow input,
  .frow select {
    padding: 6px 8px;
  }
  .list-cfg {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding: 2px 0 6px 32px;
    font-size: 12px;
  }
  .list-cfg label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text);
    cursor: pointer;
  }
  .order {
    display: flex;
    flex-direction: column;
  }
  .tiny {
    padding: 0 5px;
    font-size: 10px;
    line-height: 1.4;
  }
  .fwide {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-size: 12px;
  }
  code {
    font-size: 11px;
    color: var(--accent-2);
    white-space: nowrap;
  }
  .bad {
    border-color: var(--danger);
  }
  .err {
    font-size: 11px;
    color: var(--danger);
  }
  .help {
    margin-top: 14px;
    font-size: 13px;
  }
  .help ul {
    padding-left: 18px;
  }
  .spacer {
    flex: 1;
  }
  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
    .frow {
      grid-template-columns: 26px 1fr 1fr;
    }
    .grid2 {
      grid-template-columns: 1fr;
    }
  }
</style>
