<script lang="ts">
  import { CONDITIONS, DEFAULT_BAD_WORDS, type AttributeDef, type GridSettings } from '@ftt/shared';
  import type { GmSession } from '../lib/session/gm.svelte';
  import InviteBox from './InviteBox.svelte';
  import { download, exportZip, safeFileName } from '../lib/storage/backup';
  import { todayKey } from '../lib/storage/campaign';

  let { gm }: { gm: GmSession } = $props();

  let name = $state(gm.campaignName);
  let enabled = $state(gm.filter.enabled);
  let mode = $state(gm.filter.mode);
  let words = $state(gm.filter.words.join('\n'));
  let allowSheets = $state(gm.settings.allowPlayerSheets);

  function saveFilter() {
    const list = [...new Set(words.split('\n').map((w) => w.trim()).filter(Boolean))];
    gm.setFilter({ ...($state.snapshot(gm.filter) as typeof gm.filter), enabled, mode, words: list });
    gm.toast('Filtro de palavras atualizado.');
  }

  function restore() {
    words = DEFAULT_BAD_WORDS.join('\n');
  }

  let exporting = $state(false);

  async function backup() {
    exporting = true;
    try {
      await gm.flush();
      const zip = await exportZip(gm.store);
      download(zip, `${safeFileName(gm.campaignName)}-${todayKey()}.zip`);
    } catch (e) {
      gm.toast(`Não consegui gerar o backup: ${(e as Error).message}`, 'error');
    } finally {
      exporting = false;
    }
  }

  // ---------- atributos da campanha ----------
  const attributes = $derived(gm.settings.attributes ?? []);
  const templates = $derived(Object.values(gm.docs.templates).sort((a, b) => a.name.localeCompare(b.name)));

  function setting(patch: Partial<typeof gm.settings>) {
    gm.setSettings({ ...($state.snapshot(gm.settings) as typeof gm.settings), ...patch });
  }
  let newAttr = $state('');

  function saveAttributes(list: AttributeDef[]) {
    gm.setSettings({ ...($state.snapshot(gm.settings) as typeof gm.settings), attributes: list });
  }

  function addAttribute() {
    if (!newAttr.trim()) return;
    gm.addAttribute(newAttr);
    newAttr = '';
  }

  function renameAttribute(id: string, label: string) {
    const l = label.trim().slice(0, 30);
    if (!l) return;
    saveAttributes(($state.snapshot(attributes) as AttributeDef[]).map((a) => (a.id === id ? { ...a, label: l } : a)));
  }

  function removeAttribute(a: AttributeDef) {
    if (!confirm(`Tirar "${a.label}" da campanha? Ele some das fichas (os valores ficam guardados, caso volte).`)) return;
    saveAttributes(($state.snapshot(attributes) as AttributeDef[]).filter((x) => x.id !== a.id));
  }

  // ---------- condições e iniciativa ----------
  const NL = String.fromCharCode(10);
  let conditionsText = $state((gm.settings.conditions ?? CONDITIONS).join(NL));

  function saveConditions() {
    const list = [...new Set(conditionsText.split(NL).map((c) => c.trim().slice(0, 24)).filter(Boolean))].slice(0, 40);
    gm.setSettings({ ...($state.snapshot(gm.settings) as typeof gm.settings), conditions: list });
    gm.toast('Condições atualizadas.');
  }

  function setOrder(order: 'desc' | 'asc') {
    gm.setSettings({ ...($state.snapshot(gm.settings) as typeof gm.settings), initiativeOrder: order });
  }

  function grid(patch: Partial<GridSettings>) {
    gm.setGrid({ ...($state.snapshot(gm.map.grid) as GridSettings), ...patch });
  }
</script>

<div class="panel">
  <section>
    <h3>Convite</h3>
    <InviteBox {gm} />
  </section>

  <section>
    <h3>Mapa</h3>
    <label class="check">
      <input type="checkbox" checked={gm.map.grid.enabled} onchange={(e) => grid({ enabled: e.currentTarget.checked })} />
      Mostrar grid
    </label>
    {#if gm.map.grid.enabled}
      <div class="grid2">
        <div>
          <label for="gt">Tipo</label>
          <select id="gt" value={gm.map.grid.type} onchange={(e) => grid({ type: e.currentTarget.value as GridSettings['type'] })}>
            <option value="square">Quadrado</option>
            <option value="hex">Hexagonal</option>
          </select>
        </div>
        <div>
          <label for="gs">Tamanho da célula (px)</label>
          <input id="gs" type="number" min="20" max="400" value={gm.map.grid.size} onchange={(e) => grid({ size: Math.max(20, Math.min(400, Number(e.currentTarget.value) || 70)) })} />
        </div>
        <div>
          <label for="gu">Cada célula vale</label>
          <input id="gu" type="number" step="0.5" min="0" value={gm.map.grid.unit} onchange={(e) => grid({ unit: Number(e.currentTarget.value) || 0 })} />
        </div>
        <div>
          <label for="gl">Unidade</label>
          <input id="gl" value={gm.map.grid.unitLabel} maxlength="8" onchange={(e) => grid({ unitLabel: e.currentTarget.value.trim() || 'm' })} />
        </div>
        <div>
          <label for="gc">Cor</label>
          <input id="gc" type="color" value={gm.map.grid.color} onchange={(e) => grid({ color: e.currentTarget.value })} />
        </div>
        <div>
          <label for="go">Opacidade</label>
          <input id="go" type="range" min="0.05" max="0.8" step="0.05" value={gm.map.grid.opacity} onchange={(e) => grid({ opacity: Number(e.currentTarget.value) })} />
        </div>
      </div>
      <label class="check"><input type="checkbox" checked={gm.map.grid.snap} onchange={(e) => grid({ snap: e.currentTarget.checked })} /> Tokens encaixam no grid</label>
    {/if}
    <p class="muted small">
      Dica: coloque a imagem do mapa na camada "Mapa (fundo)" e trave (botão direito). Ajuste o tamanho da célula até bater com o desenho.
    </p>
  </section>

  <section>
    <h3>Campanha</h3>
    <label for="cn">Nome</label>
    <div class="row">
      <input id="cn" bind:value={name} maxlength="60" />
      <button onclick={() => gm.rename(name)} disabled={name.trim() === gm.campaignName}>Salvar</button>
    </div>
    <p class="muted small">
      Salvo em: <strong>{gm.store.kind === 'fs' ? `📁 ${gm.store.label}` : '🌐 este navegador'}</strong>
      {#if gm.store.kind === 'fs'}<br />Não compartilhe o arquivo campanha.json: ele tem a chave de mestre da sala.{/if}
    </p>
    <button onclick={backup} disabled={exporting}>{exporting ? 'Gerando…' : '⬇ Baixar backup (.zip)'}</button>
    <p class="muted small">
      {gm.store.kind === 'idb'
        ? 'Sua campanha está só neste navegador. Baixe backups de vez em quando: limpar os dados do navegador apaga a campanha.'
        : 'O backup serve para levar a campanha para outro PC (abra em "Importar backup" na tela inicial).'}
    </p>
  </section>

  <section>
    <h3>Atributos da campanha</h3>
    <p class="muted small">
      Os atributos que existem no seu sistema. Aparecem em todas as fichas (cada modelo pode limitar quais usa); os jogadores só preenchem os valores.
    </p>
    {#if attributes.length === 0}<p class="muted small">Nenhum atributo ainda.</p>{/if}
    <ul class="attrs">
      {#each attributes as a (a.id)}
        <li>
          <input value={a.label} maxlength="30" aria-label="Nome do atributo" onchange={(e) => renameAttribute(a.id, e.currentTarget.value)} />
          <code title="Use nas fórmulas">&#123;{a.id}&#125;</code>
          <button class="ghost danger small-btn" title="Tirar da campanha" aria-label="Tirar {a.label}" onclick={() => removeAttribute(a)}>✕</button>
        </li>
      {/each}
    </ul>
    <div class="row">
      <input bind:value={newAttr} maxlength="30" placeholder="Novo atributo (ex.: Sorte)" onkeydown={(e) => e.key === 'Enter' && addAttribute()} />
      <button onclick={addAttribute} disabled={!newAttr.trim()}>Adicionar</button>
    </div>
  </section>

  <section>
    <h3>Combate</h3>
    <label for="io">Ordem da iniciativa</label>
    <select id="io" value={gm.settings.initiativeOrder ?? 'desc'} onchange={(e) => setOrder(e.currentTarget.value as 'desc' | 'asc')}>
      <option value="desc">Maior primeiro</option>
      <option value="asc">Menor primeiro</option>
    </select>
    <label for="cond">Condições dos tokens (uma por linha)</label>
    <textarea id="cond" rows="6" bind:value={conditionsText}></textarea>
    <div class="row">
      <button onclick={saveConditions}>Salvar condições</button>
      <button class="ghost" onclick={() => (conditionsText = CONDITIONS.join(NL))}>Lista padrão</button>
    </div>
  </section>

  <section>
    <h3>Fichas</h3>
    <label class="check">
      <input
        type="checkbox"
        bind:checked={allowSheets}
        onchange={() => gm.setSettings({ ...$state.snapshot(gm.settings), allowPlayerSheets: allowSheets })}
      />
      Jogadores podem criar a própria ficha
    </label>
    <label for="ptpl">Modelo das fichas dos jogadores</label>
    <select id="ptpl" value={gm.settings.playerTemplateId ?? ''} onchange={(e) => setting({ playerTemplateId: e.currentTarget.value || undefined })}>
      <option value="">Escolha um modelo</option>
      {#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
    </select>
    <label class="check">
      <input type="checkbox" checked={!!gm.settings.showNpcHp} onchange={(e) => setting({ showNpcHp: e.currentTarget.checked || undefined })} />
      Jogadores veem a vida dos NPCs e inimigos nos tokens
    </label>
    <p class="muted small">O jogador só digita o nome; a ficha segue o modelo escolhido aqui. Cada um vê e edita só as fichas dele; você vê todas e pode liberar outras pelo 🔐.</p>
  </section>

  <section>
    <h3>Filtro de palavras</h3>
    <label class="check"><input type="checkbox" bind:checked={enabled} /> Filtrar palavras pesadas no chat e no quadro</label>
    <label for="fm">Quando aparecer uma palavra da lista</label>
    <select id="fm" bind:value={mode} disabled={!enabled}>
      <option value="user">Cada um escolhe se esconde (troca por ****)</option>
      <option value="censor">Censurar para todos (troca por ****)</option>
      <option value="block">Bloquear a mensagem</option>
    </select>
    <label for="fw">Palavras (uma por linha)</label>
    <textarea id="fw" rows="8" bind:value={words} disabled={!enabled}></textarea>
    <p class="muted small">Português, inglês e espanhol. Também pega variações: acentos, p0rr4, p.o.r.r.a, letras repetidas, plurais e fucking/fucker.</p>
    <div class="row">
      <button class="primary" onclick={saveFilter}>Salvar filtro</button>
      <button class="ghost" onclick={restore} disabled={!enabled}>Restaurar lista padrão</button>
    </div>
  </section>
</div>

<style>
  .panel {
    padding: 12px;
    overflow-y: auto;
    height: 100%;
  }
  section {
    margin-bottom: 22px;
  }
  h3 {
    font-size: 15px;
    color: var(--muted);
  }
  .small {
    font-size: 12px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 10px;
  }
  input[type='color'] {
    width: 100%;
    height: 34px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  input[type='range'] {
    width: 100%;
  }
  .attrs {
    list-style: none;
    padding: 0;
    margin: 6px 0 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .attrs li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .attrs input {
    padding: 5px 8px;
  }
  .attrs code {
    font-size: 11px;
    color: var(--accent-2);
    white-space: nowrap;
  }
  .small-btn {
    padding: 3px 7px;
  }
  textarea {
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
</style>
