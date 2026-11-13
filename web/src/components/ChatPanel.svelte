<script lang="ts">
  import { tick } from 'svelte';
  import { colorFor, type LogEntry } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import RollView from './RollView.svelte';

  let { session }: { session: TableSession } = $props();

  let text = $state('');
  let priv = $state(false);
  let listEl: HTMLDivElement;
  let stick = true;

  const DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

  $effect(() => {
    void session.log.length;
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
    if (e.to.length === 0) {
      if (e.kind === 'roll') return e.from === 'gm' ? 'rolagem oculta' : 'rolagem para o mestre';
      return 'sussurro para o mestre';
    }
    return `sussurro para ${e.to.map((p) => session.nameOf(p)).join(', ')}`;
  }

  const time = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
</script>

<div class="chat">
  <div class="log" bind:this={listEl} onscroll={onScroll}>
    {#if session.log.length === 0}
      <p class="muted empty">Nada por aqui ainda. Role um dado ou diga oi!</p>
    {/if}
    {#each session.log as e (e.id)}
      {@const p = privacy(e)}
      <div class="entry" class:private={!!p} class:system={e.kind === 'system'}>
        <div class="meta">
          <span class="name" style:color={color(e)}>{e.name}</span>
          {#if p}<span class="tag">🔒 {p}</span>{/if}
          <span class="time">{time(e.ts)}</span>
        </div>
        {#if e.kind === 'roll' && e.roll}
          <RollView roll={e.roll} />
        {:else}
          <div class="text">{e.text}</div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="tray">
    <div class="dice-row">
      {#each DICE as d (d)}
        <button class="die-btn" title="Rolar 1{d}" onclick={() => session.roll(d, priv)}>{d}</button>
      {/each}
      <button class="die-btn" title="Vantagem: 2d20, fica o maior" onclick={() => session.roll('adv', priv)}>vant</button>
      <button class="die-btn" title="Desvantagem: 2d20, fica o menor" onclick={() => session.roll('dis', priv)}>desv</button>
    </div>
    <label class="priv">
      <input type="checkbox" bind:checked={priv} />
      {session.role === 'gm' ? 'Rolagem oculta (só você vê)' : 'Rolagem privada (só o mestre vê)'}
    </label>
    <div class="row">
      <input
        bind:value={text}
        maxlength="1000"
        placeholder={session.role === 'gm' ? 'Mensagem, /r 2d6+3, /w Nome…' : 'Mensagem, /r 1d20+5, /w mestre…'}
        onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
        aria-label="Mensagem"
      />
      <button class="primary" onclick={send} disabled={!text.trim()}>Enviar</button>
    </div>
    <p class="help muted">/r 2d20kh1+4 · /gr 1d20 (privado) · /w nome mensagem · 4d6kh3 · 1d6! (explode)</p>
  </div>
</div>

<style>
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
  .dice-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .die-btn {
    padding: 4px 8px;
    font-size: 12px;
    font-weight: 600;
  }
  .priv {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    font-size: 12px;
    cursor: pointer;
  }
  .help {
    margin: 0;
    font-size: 11px;
  }
</style>
