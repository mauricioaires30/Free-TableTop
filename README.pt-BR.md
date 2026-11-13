# Free TableTop

[English](README.md) · **Português (Brasil)**

Mesa virtual de RPG grátis que roda no navegador. A campanha fica salva numa pasta no PC do mestre. Sem conta, sem envio de arquivos, sem rastreamento.

**Acesse:** [mauricioaires30.github.io/free-tabletop](https://mauricioaires30.github.io/free-tabletop/)

## Recursos
- **Campanha na sua pasta:** o mestre escolhe uma pasta uma vez, e o quadro, as imagens e o histórico do chat ficam salvos nela (`campanha.json`, `quadro.json`, `imagens/`, `log/`). Funciona no Chrome e no Edge. Nos outros navegadores, a campanha fica salva no próprio navegador.
- **Mesas privadas:** cada mesa tem um ID aleatório e um link de convite (ou QR code). Ninguém entra sem o link, e uma mesa nunca enxerga a outra.
- **Quadro livre:** zoom e arrastar, notas, cartas de pista com verso secreto e imagens que dá para arrastar, colar ou enviar.
- **Cursores ao vivo:** todo mundo vê para onde os jogadores estão apontando. O cursor do mestre fica escondido.
- **Permissões por item:** escolha quem pode **ver**, **mover** e **editar** cada coisa: todos, só o mestre, o dono ou jogadores específicos. Itens ocultos nunca chegam ao navegador dos jogadores.
- **Dados:** `2d6+3`, `4d6kh3`, `2d20kl1`, `1d6!` explosivo, `d%`, vantagem e desvantagem. A rolagem pode ser pública, só para o mestre ou oculta.
- **Chat:** `/r` para rolar, `/gr` para rolagem privada, `/w nome` para sussurrar.
- **Filtro de palavras:** bloqueia ou censura palavrões, pegando acentos, `p0rr4`, `p.o.r.r.a` e letras repetidas. O mestre edita a lista.
- **Moderação:** silenciar, expulsar e gerar um novo convite.
- **"Trazer todos":** centraliza a visão de todos os jogadores no que o mestre está vendo.

## Hospede a sua
O site roda no GitHub Pages. Um pequeno [Cloudflare Worker](relay/) gratuito repassa as mensagens entre os navegadores e não guarda nada da campanha.

1. `npx wrangler login` e `npm run deploy:relay`.
2. No repositório, crie a variável de Actions `RELAY_URL` com o endereço do worker usando `wss://` (por exemplo `wss://free-tabletop-relay.SUA-CONTA.workers.dev`).
3. Em **Settings → Pages**, escolha **GitHub Actions** como fonte. Cada push na `main` publica o site.

Para rodar localmente, use `npm install`, depois `npm run dev:relay` e `npm run dev`, e abra `localhost:5173/free-tabletop/`.

## Aviso
A mesa só funciona enquanto o mestre estiver com a campanha aberta. Cada mestre é responsável pelo que é compartilhado na sua mesa.

## Portfólio
[mauricioaires30.github.io](https://mauricioaires30.github.io/)
