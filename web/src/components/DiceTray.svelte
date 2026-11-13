<script lang="ts">
  import { tick } from 'svelte';
  import { colorFor, parseDice, type LogEntry } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import RollView from './RollView.svelte';

  // Bandeja de dados sobre o quadro: monta a rolagem, anima cada dado girando
  // e caindo até o resultado, e mostra só o histórico de rolagens.
  let { session }: { session: TableSession } = $props();

  const SIDES = [2, 3, 4, 6, 8, 10, 12, 20, 30, 100];

  let open = $state(false);
  let pool = $state<Record<number, number>>({});
  let mod = $state(0);
  let expr = $state('');
  let priv = $state(false);
  let seen = $state(0);
  let listEl = $state<HTMLDivElement | null>(null);
  let customSides = $state('');

  const rolls = $derived(session.log.filter((e) => e.kind === 'roll' || e.kind === 'table'));
  const unseen = $derived(Math.max(0, rolls.length - seen));

  const poolExpr = $derived.by(() => {
    const parts = SIDES.filter((s) => pool[s]).map((s) => `${pool[s]}d${s}`);
    for (const s of Object.keys(pool).map(Number)) if (!SIDES.includes(s) && pool[s]) parts.push(`${pool[s]}d${s}`);
    if (mod) parts.push(String(mod));
    return parts.join('+').replace(/\+-/g, '-');
  });
  const current = $derived(expr.trim() || poolExpr);

  // Na primeira vez, o que já estava no histórico não conta como novo.
  let started = false;
  $effect(() => {
    const n = rolls.length;
    if (!started) {
      started = true;
      seen = n;
    }
    if (open) {
      seen = n;
      scrollDown();
    }
  });

  function scrollDown() {
    tick().then(() => listEl && (listEl.scrollTop = listEl.scrollHeight));
  }

  function add(s: number) {
    if (!Number.isInteger(s) || s < 2 || s > 1000) return;
    expr = '';
    pool[s] = Math.min(99, (pool[s] ?? 0) + 1);
  }

  function addCustom() {
    add(parseInt(customSides, 10));
    customSides = '';
  }

  function clear() {
    pool = {};
    mod = 0;
    expr = '';
  }

  // ---------- animação: cada dado rolado gira e cai até mostrar o número real ----------

  interface Anim {
    dice: number[];
    mod: number;
    startedAt: number;
    settled: boolean;
    values: number[];
  }

  let anim = $state<Anim | null>(null);
  let spinTick = $state(0);
  let spinTimer: ReturnType<typeof setInterval> | undefined;
  let animTimeout: ReturnType<typeof setTimeout> | undefined;
  let matchedId: string | null = null;

  function startAnim(x: string) {
    let dice: number[] = [];
    let m = 0;
    try {
      for (const t of parseDice(x)) {
        if (t.kind === 'num') m += t.sign * t.value;
        else for (let i = 0; i < t.count; i++) dice.push(t.sides);
      }
    } catch {
      return; // expressão livre inválida: o servidor recusa e mostra o aviso, sem animação
    }
    if (!dice.length) return;
    clearInterval(spinTimer);
    clearTimeout(animTimeout);
    matchedId = null;
    anim = { dice, mod: m, startedAt: performance.now(), settled: false, values: [] };
    spinTimer = setInterval(() => (spinTick += 1), 90);
    animTimeout = setTimeout(() => {
      if (anim && !anim.settled) {
        clearInterval(spinTimer);
        anim = null;
      }
    }, 6000);
    scrollDown();
  }

  function faceFor(sides: number, seed: number): number {
    const h = (seed * 2654435761 + spinTick * 97) >>> 0;
    return 1 + (h % sides);
  }

  function realDiceValues(entry: LogEntry): number[] {
    const out: number[] = [];
    if (!entry.roll) return out;
    for (const p of entry.roll.parts) if (p.type === 'dice') for (const r of p.rolls) if (!r.exploded) out.push(r.value);
    return out;
  }

  // Casa a próxima rolagem minha que chegar com a animação em andamento.
  $effect(() => {
    void session.log.length;
    if (!anim || anim.settled) return;
    const mine = session.role === 'gm' ? 'gm' : session.myPid;
    const found = [...session.log]
      .reverse()
      .find((e) => e.kind === 'roll' && e.from === mine && e.id !== matchedId && e.ts + 800 >= anim!.startedAt);
    if (!found) return;
    matchedId = found.id;
    const values = realDiceValues(found);
    const wait = Math.max(0, 550 - (performance.now() - anim.startedAt));
    clearTimeout(animTimeout);
    setTimeout(() => {
      if (!anim) return;
      clearInterval(spinTimer);
      anim = { ...anim, settled: true, values };
      scrollDown();
      setTimeout(() => (anim = null), 900);
    }, wait);
  });

  function roll(e?: string) {
    const x = e ?? current;
    if (!x) return;
    startAnim(x);
    session.roll(x, priv);
    if (!e) clear();
  }

  function color(e: LogEntry) {
    return e.from === 'gm' ? 'var(--accent-2)' : colorFor(e.from);
  }

  function privacy(e: LogEntry): string | null {
    if (!e.to) return null;
    return e.from === 'gm' ? 'oculta' : 'para o mestre';
  }

  const time = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
</script>

{#if !open}
  <button class="fab" onclick={() => (open = true)} title="Bandeja de dados" aria-label="Abrir bandeja de dados">
    🎲
    {#if unseen}<span class="badge">{unseen > 9 ? '9+' : unseen}</span>{/if}
  </button>
{:else}
  <section class="tray" aria-label="Bandeja de dados">
    <header>
      <strong>Dados</strong>
      <button class="ghost icon" onclick={() => (open = false)} aria-label="Fechar bandeja">✕</button>
    </header>

    <div class="history" bind:this={listEl}>
      {#if rolls.length === 0 && !anim}
        <p class="muted empty">Nenhuma rolagem ainda.</p>
      {/if}
      {#each rolls.slice(-60) as e (e.id)}
        {@const p = privacy(e)}
        <div class="entry" class:private={!!p}>
          <div class="meta">
            <span class="name" style:color={color(e)}>{e.name}</span>
            {#if p}<span class="tag">🔒 {p}</span>{/if}
            <span class="time">{time(e.ts)}</span>
          </div>
          {#if e.label}<div class="label">{e.kind === 'table' ? '🎲 ' : ''}{e.label}</div>{/if}
          {#if e.kind === 'table'}
            <div class="table-result">{e.text}</div>
          {:else if e.roll}
            <RollView roll={e.roll} />
          {/if}
        </div>
      {/each}
      {#if anim}
        <div class="entry anim-entry" aria-live="polite">
          <div class="spin-row">
            {#each anim.dice as sides, i (i)}
              <span class="spin-die" class:settled={anim.settled} style:animation-delay="{i * 45}ms">
                {anim.settled ? (anim.values[i] ?? faceFor(sides, i)) : faceFor(sides, i)}
              </span>
            {/each}
            {#if anim.mod}<span class="spin-mod">{anim.mod > 0 ? '+' : ''}{anim.mod}</span>{/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="builder">
      <div class="dice">
        {#each SIDES as s (s)}
          <button class="die" class:on={!!pool[s]} onclick={() => add(s)} title="Adicionar 1d{s}">
            d{s}{#if pool[s]}<span class="count">{pool[s]}</span>{/if}
          </button>
        {/each}
      </div>
      <div class="row">
        <input
          class="custom"
          bind:value={customSides}
          placeholder="outro (lados)"
          inputmode="numeric"
          maxlength="4"
          aria-label="Lados de um dado personalizado"
          onkeydown={(e) => e.key === 'Enter' && addCustom()}
        />
        <button class="ghost small" onclick={addCustom} disabled={!customSides.trim()}>+ dado</button>
        <button class="ghost tiny" onclick={() => (mod -= 1)} aria-label="Diminuir modificador">−</button>
        <span class="mod">{mod >= 0 ? '+' : ''}{mod}</span>
        <button class="ghost tiny" onclick={() => (mod += 1)} aria-label="Aumentar modificador">+</button>
      </div>
      <div class="row">
        <button class="ghost small" onclick={() => roll('adv')} title="2d20, fica o maior">vant</button>
        <button class="ghost small" onclick={() => roll('dis')} title="2d20, fica o menor">desv</button>
        <button class="ghost small" onclick={clear} disabled={!current}>limpar</button>
      </div>
      <div class="row">
        <input
          bind:value={expr}
          placeholder={poolExpr || 'ex.: 4d6kh3, 1d20+5, 2d6!'}
          maxlength="100"
          aria-label="Expressão de dados"
          onkeydown={(e) => e.key === 'Enter' && roll()}
        />
        <button class="primary" onclick={() => roll()} disabled={!current}>Rolar</button>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={priv} />
        {session.role === 'gm' ? 'Rolagem oculta (só você vê)' : 'Só o mestre vê'}
      </label>
    </div>
  </section>
{/if}

<style>
  .fab {
    position: absolute;
    right: 14px;
    bottom: 14px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    font-size: 24px;
    padding: 0;
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 4;
  }
  .fab:hover {
    background: #d24434 !important;
  }
  .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent-2);
    color: #111;
    font-size: 11px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
  .tray {
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: min(340px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    display: flex;
    flex-direction: column;
    background: rgba(22, 25, 32, 0.97);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.55);
    z-index: 4;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 8px 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  header strong {
    font-family: var(--font-title);
    font-weight: 400;
    font-size: 17px;
    color: var(--accent-2);
  }
  .icon {
    padding: 3px 8px;
  }
  .history {
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 80px;
    max-height: 300px;
  }
  .empty {
    text-align: center;
    margin: 16px 0;
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
  .label {
    font-size: 12px;
    color: var(--accent-2);
    margin-top: 2px;
  }
  .table-result {
    background: var(--bg);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-2);
    border-radius: 8px;
    padding: 6px 10px;
    margin-top: 3px;
    white-space: pre-wrap;
  }
  .spin-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }
  .spin-die {
    display: inline-grid;
    place-items: center;
    min-width: 28px;
    height: 28px;
    padding: 0 4px;
    border-radius: 6px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-weight: 700;
    font-size: 13px;
    animation: dice-spin 0.5s linear infinite;
  }
  .spin-die.settled {
    animation: dice-settle 0.45s ease-out;
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .spin-mod {
    color: var(--muted);
    font-weight: 600;
  }
  @keyframes dice-spin {
    0% {
      transform: translateY(-5px) rotate(0deg);
    }
    50% {
      transform: translateY(3px) rotate(180deg);
    }
    100% {
      transform: translateY(-5px) rotate(360deg);
    }
  }
  @keyframes dice-settle {
    0% {
      transform: translateY(-16px) rotate(-30deg) scale(0.75);
      opacity: 0.5;
    }
    60% {
      transform: translateY(4px) rotate(10deg) scale(1.1);
      opacity: 1;
    }
    100% {
      transform: translateY(0) rotate(0deg) scale(1);
    }
  }
  .builder {
    border-top: 1px solid var(--border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dice {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }
  .die {
    position: relative;
    padding: 7px 0;
    font-size: 12px;
    font-weight: 700;
  }
  .die.on {
    border-color: var(--accent-2);
    color: var(--accent-2);
  }
  .count {
    position: absolute;
    top: -6px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    border-radius: 99px;
    background: var(--accent-2);
    color: #111;
    font-size: 10px;
    display: grid;
    place-items: center;
  }
  .custom {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    font-size: 12px;
  }
  .tiny {
    padding: 2px 9px;
  }
  .small {
    padding: 4px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .mod {
    min-width: 28px;
    text-align: center;
    font-weight: 700;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--text);
  }
</style>
