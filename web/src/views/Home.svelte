<script lang="ts">
  import { onMount } from 'svelte';
  import { active, go, parseInviteLink } from '../lib/router.svelte';
  import { GmSession } from '../lib/session/gm.svelte';
  import { newCampaign, PATHS } from '../lib/storage/campaign';
  import {
    ensurePermission, forgetCampaign, FsStore, hasFolderAccess, IdbStore, listRecent, rememberCampaign,
    type CampaignStore, type RecentCampaign,
  } from '../lib/storage/store';

  const folderOk = hasFolderAccess();
  let name = $state('');
  let link = $state('');
  let busy = $state(false);
  let error = $state('');
  let recent = $state<RecentCampaign[]>([]);

  onMount(async () => {
    recent = await listRecent();
  });

  const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
  const folderName = (n: string) => n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'Campanha';

  async function run(fn: () => Promise<void>) {
    error = '';
    busy = true;
    try {
      await fn();
    } catch (e) {
      if (!isAbort(e)) error = (e as Error).message || String(e);
    } finally {
      busy = false;
    }
  }

  async function openStore(store: CampaignStore, handle?: FileSystemDirectoryHandle) {
    const s = await GmSession.open(store);
    if (!s) throw new Error(`Não encontrei ${PATHS.campaign} nessa pasta. Escolha a pasta da campanha (a que tem esse arquivo).`);
    await rememberCampaign({ roomId: s.roomId, name: s.campaignName, kind: store.kind, handle, lastOpened: Date.now() });
    active.gm = s;
    go(`/mestre/${s.roomId}`);
  }

  const create = () =>
    run(async () => {
      const c = newCampaign(name);
      if (folderOk) {
        const parent = await window.showDirectoryPicker!({ id: 'ftt-campanhas', mode: 'readwrite' });
        const dir = await parent.getDirectoryHandle(folderName(c.name), { create: true });
        const store = new FsStore(dir);
        if (await store.readText(PATHS.campaign)) {
          if (!confirm(`A pasta "${dir.name}" já tem uma campanha. Abrir ela?`)) return;
          return openStore(store, dir);
        }
        await store.writeText(PATHS.campaign, JSON.stringify(c, null, 2));
        await store.writeText(PATHS.board, JSON.stringify({ version: 1, items: [] }));
        return openStore(store, dir);
      }
      const store = new IdbStore(c.roomId);
      await store.writeText(PATHS.campaign, JSON.stringify(c, null, 2));
      await openStore(store);
    });

  const openFolder = () =>
    run(async () => {
      const dir = await window.showDirectoryPicker!({ id: 'ftt-campanhas', mode: 'readwrite' });
      await openStore(new FsStore(dir), dir);
    });

  const openRecent = (r: RecentCampaign) =>
    run(async () => {
      if (r.kind === 'fs') {
        if (!r.handle) throw new Error('Pasta não encontrada. Use "Escolher pasta".');
        if (!(await ensurePermission(r.handle))) throw new Error('Sem permissão para acessar a pasta.');
        return openStore(new FsStore(r.handle), r.handle);
      }
      await openStore(new IdbStore(r.roomId));
    });

  async function forget(r: RecentCampaign) {
    const msg = r.kind === 'idb'
      ? `Tirar "${r.name}" da lista? A campanha continua salva neste navegador.`
      : `Tirar "${r.name}" da lista? Os arquivos continuam na pasta.`;
    if (!confirm(msg)) return;
    await forgetCampaign(r.roomId);
    recent = await listRecent();
  }

  function join() {
    const p = parseInviteLink(link);
    if (!p) {
      error = 'Link de convite inválido. Ele parece com …#/sala/abc123?c=xyz';
      return;
    }
    go(`/sala/${p.roomId}?c=${encodeURIComponent(p.invite)}`);
  }
</script>

<div class="home">
  <header class="hero">
    <div class="logo">
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="56" height="56" />
      <div>
        <h1>Free TableTop</h1>
        <p class="muted">Mesa virtual de RPG grátis. Quadro livre, dados e chat — e a campanha fica salva no PC do mestre.</p>
      </div>
    </div>
  </header>

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  <div class="grid">
    <section class="card">
      <h2>Criar mesa</h2>
      <p class="muted">
        {#if folderOk}
          Você escolhe onde salvar e eu crio uma pasta com o nome da campanha lá dentro.
        {:else}
          Seu navegador não permite salvar em pastas (use Chrome ou Edge para isso). A campanha ficará salva neste navegador.
        {/if}
      </p>
      <label for="cname">Nome da campanha</label>
      <input id="cname" bind:value={name} placeholder="Ex.: O Segredo na Floresta" maxlength="60" onkeydown={(e) => e.key === 'Enter' && create()} />
      <button class="primary wide" disabled={busy} onclick={create}>
        {folderOk ? 'Escolher local e criar' : 'Criar mesa'}
      </button>
    </section>

    <section class="card">
      <h2>Abrir campanha</h2>
      {#if recent.length}
        <ul class="recent">
          {#each recent as r (r.roomId)}
            <li>
              <button class="ghost name" disabled={busy} onclick={() => openRecent(r)}>
                <strong>{r.name}</strong>
                <span class="muted">{r.kind === 'fs' ? `📁 ${r.handle?.name ?? ''}` : '🌐 neste navegador'} · {new Date(r.lastOpened).toLocaleDateString('pt-BR')}</span>
              </button>
              <button class="ghost" title="Tirar da lista" aria-label="Tirar da lista" onclick={() => forget(r)}>✕</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Nenhuma campanha recente neste navegador.</p>
      {/if}
      {#if folderOk}
        <button class="wide" disabled={busy} onclick={openFolder}>Escolher pasta da campanha…</button>
      {/if}
    </section>

    <section class="card">
      <h2>Entrar como jogador</h2>
      <p class="muted">Cole o link de convite que o mestre mandou.</p>
      <label for="link">Link de convite</label>
      <input id="link" bind:value={link} placeholder="https://…#/sala/…?c=…" onkeydown={(e) => e.key === 'Enter' && join()} />
      <button class="wide" onclick={join} disabled={!link.trim()}>Entrar</button>
    </section>
  </div>

  <section class="how">
    <h3>Como funciona</h3>
    <ol class="muted">
      <li>O mestre cria a mesa e escolhe uma pasta no PC. Tudo da campanha (quadro, imagens, chat) fica nessa pasta.</li>
      <li>O mestre manda o link de convite para os jogadores. Cada mesa é isolada: ninguém de fora entra sem o link.</li>
      <li>A mesa funciona enquanto o mestre estiver com ela aberta. O mestre decide quem vê e mexe em cada coisa.</li>
    </ol>
  </section>
</div>

<style>
  .home {
    max-width: 1100px;
    margin: 0 auto;
    padding: 40px 16px 60px;
    min-height: 100%;
  }
  .hero {
    margin-bottom: 28px;
  }
  .logo {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .logo h1 {
    font-size: 40px;
    margin: 0;
    color: var(--paper);
  }
  .logo p {
    margin: 4px 0 0;
    max-width: 620px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
  }
  .card h2 {
    font-size: 22px;
    color: var(--accent-2);
  }
  .card p {
    margin: 0 0 4px;
    font-size: 13px;
  }
  .wide {
    width: 100%;
    margin-top: auto;
    padding: 10px;
  }
  .card label + input {
    margin-bottom: 14px;
  }
  .recent {
    list-style: none;
    padding: 0;
    margin: 0 0 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 240px;
    overflow: auto;
  }
  .recent li {
    display: flex;
    gap: 4px;
  }
  .recent .name {
    flex: 1;
    text-align: left;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .recent .name span {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    background: rgba(224, 82, 82, 0.12);
    border: 1px solid var(--danger);
    color: #ffb4b4;
    padding: 10px 14px;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .how {
    margin-top: 32px;
  }
  .how ol {
    padding-left: 20px;
    max-width: 760px;
  }
  .how li {
    margin-bottom: 6px;
  }
</style>
