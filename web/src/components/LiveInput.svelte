<script lang="ts">
  // Campo que salva sozinho enquanto você digita, sem ser sobrescrito por
  // atualizações que chegam da rede enquanto está com o foco.
  let {
    value,
    type = 'text',
    disabled = false,
    rows = 3,
    placeholder = '',
    maxlength,
    label,
    class: cls = '',
    onCommit,
  }: {
    value: string | number;
    type?: 'text' | 'number' | 'textarea';
    disabled?: boolean;
    rows?: number;
    placeholder?: string;
    maxlength?: number;
    label?: string;
    class?: string;
    onCommit: (v: string | number) => void;
  } = $props();

  let draft = $state(String(value ?? ''));
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const v = String(value ?? '');
    if (!focused) draft = v;
  });

  function parse(): string | number | null {
    if (type !== 'number') return draft;
    const n = parseFloat(draft.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function commit() {
    clearTimeout(timer);
    const v = parse();
    if (v !== null && String(v) !== String(value)) onCommit(v);
  }

  function onInput(e: Event) {
    draft = (e.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(commit, type === 'number' ? 350 : 600);
  }

  function onBlur() {
    focused = false;
    commit();
    draft = String(value ?? '');
  }
</script>

{#if type === 'textarea'}
  <textarea
    class={cls}
    {rows}
    {disabled}
    {placeholder}
    {maxlength}
    aria-label={label}
    value={draft}
    oninput={onInput}
    onfocus={() => (focused = true)}
    onblur={onBlur}
  ></textarea>
{:else}
  <input
    class={cls}
    type="text"
    inputmode={type === 'number' ? 'decimal' : undefined}
    {disabled}
    {placeholder}
    {maxlength}
    aria-label={label}
    value={draft}
    oninput={onInput}
    onfocus={(e) => {
      focused = true;
      if (type === 'number') (e.currentTarget as HTMLInputElement).select();
    }}
    onblur={onBlur}
    onkeydown={(e) => {
      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      if (type === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const n = Number(parse() ?? 0) + (e.key === 'ArrowUp' ? 1 : -1);
        draft = String(n);
        onCommit(n);
      }
    }}
  />
{/if}
