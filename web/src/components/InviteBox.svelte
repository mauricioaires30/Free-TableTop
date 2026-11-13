<script lang="ts">
  import QRCode from 'qrcode';
  import type { GmSession } from '../lib/session/gm.svelte';

  let { gm }: { gm: GmSession } = $props();

  let qr = $state('');
  let copied = $state(false);
  const link = $derived(gm.inviteLink);

  $effect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: '#14161c', light: '#efe4cc' } })
      .then((u) => (qr = u))
      .catch(() => (qr = ''));
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      prompt('Copie o link:', link);
    }
  }

  function regen() {
    if (confirm('Gerar um novo convite? O link atual deixa de funcionar para quem ainda não entrou.')) gm.regenerateInvite();
  }
</script>

<div class="invite">
  <div class="row">
    <input readonly value={link} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} aria-label="Link de convite" />
    <button class="primary" onclick={copy}>{copied ? 'Copiado!' : 'Copiar'}</button>
  </div>
  {#if qr}
    <img src={qr} alt="QR code do convite" width="200" height="200" />
  {/if}
  <button class="ghost small" onclick={regen}>Gerar novo convite</button>
</div>

<style>
  .invite {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }
  .invite .row {
    width: 100%;
  }
  img {
    border-radius: 8px;
  }
  .small {
    font-size: 12px;
  }
</style>
