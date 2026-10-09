# Deploy sem custo inicial

O frontend fica no Vercel. A API usa o plano gratuito do Render; o PostgreSQL
e os arquivos ficam no Supabase. O Vercel encaminha `/api/*` para a API usando
`BACKEND_API_URL`.

## 1. Criar o projeto Supabase

1. Crie um projeto no Supabase.
2. Em **Project Settings → Database**, copie a connection string do **Session
   pooler** no formato URI e guarde-a como `DATABASE_URL`. Substitua a senha
   pelo valor que você definiu ao criar o projeto.
3. Em **Project Settings → API**, copie a Project URL (`SUPABASE_URL`) e a
   chave `service_role` (`SUPABASE_SERVICE_ROLE_KEY`). A chave `service_role`
   é secreta: use-a apenas no Render, nunca no frontend ou no Vercel.
4. Em **Storage**, crie dois buckets:
   - `uploads`: **public** (para capas e banners).
   - `ebooks`: **private** (para PDFs vendidos por e-mail).

## 2. Criar a API no Render

1. Envie as alterações do projeto ao GitHub.
2. No Render, escolha **New + → Blueprint** e conecte este repositório.
3. O Blueprint usa o plano **Free** e não cria banco nem disco no Render.
   Informe os valores de `DATABASE_URL`, `SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY` quando solicitado. O Render gera `JWT_SECRET`.
4. Aguarde o deploy e abra o serviço `nocturnal-api` → **Settings** →
   **Domains** para copiar a URL HTTPS.
5. Abra `https://SUA-URL-DO-RENDER/health`; deve responder
   `{"status":"ok"}`.

## 3. Apontar o Vercel para a API

1. No Vercel, abra o projeto do frontend.
2. Em **Settings → Environment Variables**, adicione `BACKEND_API_URL` com a
   URL HTTPS do serviço Render, sem caminho adicional. Exemplo:
   `https://nocturnal-api.onrender.com`.
3. Marque Production e Preview e faça um novo deploy.

O site usa o próprio domínio para chamar a API. Não coloque a chave
`SUPABASE_SERVICE_ROLE_KEY` no Vercel.

## E-mail e pagamentos

Para habilitar e-mail, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` nas variáveis do serviço `nocturnal-api`.
O Render Free bloqueia as portas SMTP comuns 25, 465 e 587; use um provedor
que ofereça SMTP na porta 2525 ou um serviço de e-mail por HTTPS.
Para pagamentos, configure `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_WEBHOOK_SECRET` e `MERCADOPAGO_NOTIFICATION_URL`, usando
`https://SUA-URL-DO-RENDER/api/orders/webhook/mercadopago` como URL do webhook.

## Limites do plano gratuito

O serviço gratuito do Render pode dormir após inatividade e levar cerca de um
minuto para responder ao primeiro acesso. Serviços e armazenamento gratuitos
têm limites de uso, disponibilidade e espaço que podem mudar. Essa configuração
é adequada para testar ou manter um projeto pequeno, mas não oferece a mesma
persistência/garantia de um plano pago. Verifique os limites atuais do Render e
do Supabase antes de usar para vendas reais. Projetos Supabase Free podem ser
pausados após uma semana sem atividade e incluem limites de banco e arquivos.

## Dados existentes

Os dados do Railway não são copiados automaticamente. Para manter contas,
pedidos, livros e arquivos, migre o banco para o Supabase e envie capas,
banners e PDFs aos buckets correspondentes antes de apontar o Vercel para a
nova API. Os PDFs devem ficar no bucket privado `ebooks`; as imagens no bucket
público `uploads`.

## Verificação

- Execute `npm test` e `npm run build:frontend`.
- Abra o domínio do Vercel e confira livros, login e imagens.
- Teste upload de capa, banner e PDF no painel administrativo.
- Se usar pagamentos, faça um pedido de teste e confirme recebimento do PDF.
