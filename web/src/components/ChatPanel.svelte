<script lang="ts">
  import { tick } from 'svelte';
  import { colorFor, type LogEntry } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';

  let { session }: { session: TableSession } = $props();

  let text = $state('');
  let listEl: HTMLDivElement;
  let stick = true;

  // O chat é só conversa: rolagens ficam na bandeja de dados sobre o quadro.
  const messages = $derived(session.log.filter((e) => e.kind === 'chat' || e.kind === 'system'));

  $effect(() => {
    void messages.length;
    tick().then(() => {
      if (stick && listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  });

  function onScroll() {
    stick = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 60;
  }

  function send() {
    if (session.chat(text)) text = '';
  }

  function color(e: LogEntry) {
    return e.from === 'gm' ? 'var(--accent-2)' : colorFor(e.from);
  }

  function privacy(e: LogEntry): string | null {
    if (!e.to) return null;
    if (e.to.length === 0) return 'sussurro para o mestre';
    return `sussurro para ${e.to.map((p) => session.nameOf(p)).join(', ')}`;
  }

  const time = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
</script>

<div class="chat">
  <div class="log" bind:this={listEl} onscroll={onScroll}>
    {#if messages.length === 0}
      <p class="muted empty">Nada por aqui ainda. Diga oi! Os dados ficam na bandeja 🎲 do quadro.</p>
    {/if}
    {#each messages as e (e.id)}
      {@const p = privacy(e)}
      <div class="entry" class:private={!!p} class:system={e.kind === 'system'}>
        <div class="meta">
          <span class="name" style:color={color(e)}>{e.name}</span>
          {#if p}<span class="tag">🔒 {p}</span>{/if}
          <span class="time">{time(e.ts)}</span>
        </div>
        <div class="text">{session.clean(e.text ?? "")}</div>
      </div>
    {/each}
  </div>

  <div class="tray">
    <div class="row">
      <input
        bind:value={text}
        maxlength="1000"
        placeholder={session.role === 'gm' ? 'Mensagem ou /w Nome…' : 'Mensagem ou /w mestre…'}
        onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
        aria-label="Mensagem"
      />
      <button class="primary" onclick={send} disabled={!text.trim()}>Enviar</button>
    </div>
    <div class="foot">
      <p class="help muted">/w nome mensagem sussurra · /r 1d20 também rola (o resultado vai para a bandeja 🎲)</p>
      <label class="hide" title="Só na sua tela">
        <input type="checkbox" checked={session.hideBadWords} onchange={(e) => session.setHideBadWords(e.currentTarget.checked)} />
        Esconder palavrões
      </label>
    </div>
  </div>
</div>

<style>
  .foot {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .hide {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    cursor: pointer;
    margin-top: 4px;
  }
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .log {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .empty {
    text-align: center;
    margin-top: 30px;
  }
  .entry {
    font-size: 13px;
  }
  .entry.private {
    border-left: 2px solid #6b4fa0;
    padding-left: 8px;
  }
  .meta {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .name {
    font-weight: 600;
  }
  .tag {
    font-size: 11px;
    color: #b39ddb;
  }
  .time {
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
  }
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .tray {
    border-top: 1px solid var(--border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .help {
    margin: 0;
    font-size: 11px;
  }
</style>
