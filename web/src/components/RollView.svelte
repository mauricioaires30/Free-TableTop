<script lang="ts">
  import { dieLabel, isSuccessRoll, type RollResult } from '@ftt/shared';

  let { roll }: { roll: RollResult } = $props();

  const isCrit = (sides: number, v: number) => sides === 20 && v === 20;
  const isFumble = (sides: number, v: number) => sides === 20 && v === 1;
  const successes = $derived(isSuccessRoll(roll));
</script>

<div class="roll">
  <div class="expr">{roll.expr}</div>
  <div class="dice">
    {#each roll.parts as p, i (i)}
      {#if i > 0 || p.sign < 0}<span class="op">{p.sign < 0 ? '−' : '+'}</span>{/if}
      {#if p.type === 'num'}
        <span class="num">{p.value}</span>
      {:else}
        {#each p.rolls as d, j (j)}
          <span
            class="die"
            class:dropped={!d.kept}
            class:crit={!p.target && d.kept && isCrit(p.sides, d.value)}
            class:fumble={!p.target && d.kept && isFumble(p.sides, d.value)}
            class:hit={d.hit}
            class:miss={!!p.target && d.kept && !d.hit}
            class:exploded={d.exploded}
            title="{p.fate ? 'dF' : `d${p.sides}`}{d.exploded ? ' (explodiu)' : ''}{d.rerolled !== undefined ? ` (rerrolado, era ${d.rerolled})` : ''}{d.kept ? '' : ' (descartado)'}{d.hit ? ' (sucesso)' : ''}"
            >{dieLabel(p, d.value)}</span
          >
        {/each}
      {/if}
    {/each}
    <span class="eq">=</span>
    <span class="total">{roll.total}</span>
    {#if successes}<span class="succ">{roll.total === 1 ? 'sucesso' : 'sucessos'}</span>{/if}
  </div>
</div>

<style>
  .roll {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    margin-top: 3px;
  }
  .expr {
    font-size: 12px;
    color: var(--muted);
    font-family: ui-monospace, monospace;
  }
  .dice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }
  .die,
  .num {
    min-width: 24px;
    height: 24px;
    padding: 0 5px;
    display: inline-grid;
    place-items: center;
    border-radius: 5px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-weight: 600;
    font-size: 13px;
  }
  .num {
    background: transparent;
    border-style: dashed;
  }
  .die.dropped {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .die.crit {
    border-color: var(--ok);
    color: #8be0ae;
  }
  .die.fumble {
    border-color: var(--danger);
    color: #ff9a9a;
  }
  .die.hit {
    border-color: var(--ok);
    background: rgba(76, 175, 122, 0.18);
    color: #8be0ae;
  }
  .die.miss {
    opacity: 0.55;
  }
  .succ {
    font-size: 12px;
    color: var(--muted);
  }
  .die.exploded {
    border-style: dotted;
  }
  .op,
  .eq {
    color: var(--muted);
  }
  .total {
    font-size: 20px;
    font-weight: 700;
    color: var(--accent-2);
    margin-left: 2px;
  }
</style>
