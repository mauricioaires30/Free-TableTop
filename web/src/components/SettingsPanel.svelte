<script lang="ts">
  import { DEFAULT_BAD_WORDS } from '@ftt/shared';
  import type { GmSession } from '../lib/session/gm.svelte';
  import InviteBox from './InviteBox.svelte';

  let { gm }: { gm: GmSession } = $props();

  let name = $state(gm.campaignName);
  let enabled = $state(gm.filter.enabled);
  let mode = $state(gm.filter.mode);
  let words = $state(gm.filter.words.join('\n'));

  function saveFilter() {
    const list = [...new Set(words.split('\n').map((w) => w.trim()).filter(Boolean))];
    gm.setFilter({ enabled, mode, words: list });
    gm.toast('Filtro de palavras atualizado.');
  }

  function restore() {
    words = DEFAULT_BAD_WORDS.join('\n');
  }
</script>

<div class="panel">
  <section>
    <h3>Convite</h3>
    <InviteBox {gm} />
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
  </section>

  <section>
    <h3>Filtro de palavras</h3>
    <label class="check"><input type="checkbox" bind:checked={enabled} /> Filtrar palavras pesadas no chat e no quadro</label>
    <label for="fm">Quando aparecer uma palavra da lista</label>
    <select id="fm" bind:value={mode} disabled={!enabled}>
      <option value="censor">Censurar (troca por ****)</option>
      <option value="block">Bloquear a mensagem</option>
    </select>
    <label for="fw">Palavras (uma por linha)</label>
    <textarea id="fw" rows="8" bind:value={words} disabled={!enabled}></textarea>
    <p class="muted small">Também pega variações: acentos, p0rr4, p.o.r.r.a, letras repetidas e plurais.</p>
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
  textarea {
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
</style>
