# Deploy

O frontend fica no Vercel. A API Express, o PostgreSQL e os arquivos enviados
ficam no Render. O Vercel encaminha `/api/*` e `/uploads/*` para a API Render
usando `BACKEND_API_URL`.

## 1. Publicar API e banco no Render

1. Envie as alterações deste repositório para o GitHub.
2. No Render, escolha **New + → Blueprint** e conecte este repositório.
3. O Render vai ler `render.yaml` e propor criar a API e o PostgreSQL. Confira
   os serviços antes de confirmar. A configuração usa um serviço `starter`, um
   banco `basic-256mb` e um disco persistente de 1 GB; são recursos pagos do
   Render.
4. Aguarde o deploy terminar e abra o serviço `nocturnal-api` → **Settings** →
   **Domains**. Copie a URL pública HTTPS da API.
5. Abra `https://SUA-URL-DO-RENDER/health`. A resposta esperada é
   `{"status":"ok"}`.

O Blueprint configura `DATABASE_URL`, `JWT_SECRET` e `STORAGE_DIR=/data`.
Capas, banners e PDFs privados ficam no disco persistente montado em `/data`.
Não remova esse disco: os caminhos dos PDFs são salvos no banco.

Para habilitar e-mail, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` nas variáveis do serviço `nocturnal-api`.
Para pagamentos, configure `MERCADOPAGO_ACCESS_TOKEN` e
`MERCADOPAGO_WEBHOOK_SECRET`. Configure também
`MERCADOPAGO_NOTIFICATION_URL` como
`https://SUA-URL-DO-RENDER/api/orders/webhook/mercadopago`.

## 2. Publicar o frontend no Vercel

1. No Vercel, importe o mesmo repositório. Mantenha a raiz do projeto como
   diretório raiz.
2. Em **Settings → Environment Variables**, adicione
   `BACKEND_API_URL` com a origem HTTPS do serviço Render, sem caminho extra.
   Exemplo: `https://nocturnal-api.onrender.com`.
3. Habilite a variável para Production e Preview e faça o deploy.

O `vercel.json` executa `npm run build:frontend`, publica `dist` e mantém as
chamadas da API no mesmo domínio do site, encaminhando-as para o Render.

## 3. Conferir o site

- Abra o domínio do Vercel e confira livros, login e imagens.
- Teste imagens de capas e banners no painel administrativo.
- Se usar pagamentos, faça um pedido de teste e confira o webhook e o e-mail.
- Execute `npm test` para validar as rotas e o proxy localmente.

## Importante sobre dados antigos

Criar os serviços no Render não copia automaticamente os dados do Railway. Se
existirem pedidos, contas, livros ou arquivos que precisam ser preservados,
faça a migração do PostgreSQL e copie os arquivos antigos para o disco `/data`
antes de apontar o Vercel para o Render.
