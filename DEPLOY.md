# Publicar no Netlify Free

O site estático e a API Express são publicados juntos no Netlify. As tabelas
ficam no PostgreSQL do Supabase e capas, banners e e-books ficam no Supabase
Storage. Os PDFs são enviados do navegador diretamente ao Storage usando uma
URL temporária emitida pela API; assim, o upload não atravessa o limite de
payload das Netlify Functions.

## 1. Preparar o Supabase

1. No projeto Supabase, crie os buckets:
   - `uploads`: público, para capas e banners.
   - `ebooks`: privado, para PDFs vendidos.
2. Configure o limite máximo dos buckets: `uploads` até 10 MB e `ebooks` até
   18 MB. Aceite apenas JPEG, PNG e WebP em `uploads`, e PDF em `ebooks`.
3. Em **Connect**, copie a connection string URI do **Session pooler** e
   substitua `[YOUR-PASSWORD]` pela senha do banco. Essa será a variável
   `DATABASE_URL`; codifique caracteres especiais na senha para URL.
4. Em **Project Settings → API**, copie a Project URL para `SUPABASE_URL`, a
   chave pública `anon`/publishable para `SUPABASE_ANON_KEY`, e a chave secreta
   `service_role`/secret para `SUPABASE_SERVICE_ROLE_KEY`.
5. Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` no frontend nem a compartilhe.

## 2. Publicar no Netlify

1. Envie as alterações do repositório ao GitHub.
2. No Netlify, escolha **Add new site → Import an existing project** e conecte
   `adriano562/site-de-venda-de-livros`, branch `main`.
3. Deixe a raiz do repositório como diretório base. O `netlify.toml` configura
   build `npm run build:frontend`, pasta publicada `dist` e a função da API.
4. Em **Site configuration → Environment variables**, configure:
   - `DATABASE_URL`
   - `JWT_SECRET` (uma string longa e aleatória)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Salve e faça um novo deploy.
6. Teste `https://SEU-SITE.netlify.app/health`; deve responder
   `{"status":"ok"}`.
7. Depois que o primeiro acesso à API criar as tabelas, crie o administrador
   uma única vez chamando `POST https://SEU-SITE.netlify.app/api/auth/setup`
   com JSON contendo `name`, `email` e uma senha forte de pelo menos 8
   caracteres. O endpoint bloqueia novas criações depois do primeiro admin.

O plano Free do Netlify informa 300 créditos mensais. Verifique o painel de uso
e os termos atuais da conta; se pedir cartão ou mostrar cobrança, não confirme
e pare nessa etapa. O Netlify limita a 6 MB o payload de uma Function (cerca
de 4,5 MB para arquivos binários); os uploads de capa/PDF deste projeto usam
URLs temporárias para enviar os arquivos diretamente ao Supabase.

## 3. E-mail e pagamentos

Para habilitar e-mail, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` nas variáveis do Netlify. Confira com o
provedor se as conexões SMTP de saída são aceitas; se não forem, será preciso
usar uma API HTTPS de envio de e-mail.

Para pagamentos, configure `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_WEBHOOK_SECRET` e `MERCADOPAGO_NOTIFICATION_URL`. Use como URL do
webhook `https://SEU-SITE.netlify.app/api/orders/webhook/mercadopago`.

## 4. Testar

- Rode `npm test` e `npm run build:frontend`.
- Abra o domínio Netlify, confira catálogo, login e painel administrativo.
- Teste upload de capa e PDF; o PDF deve permanecer privado no bucket `ebooks`.
- Se usar banners por API, teste também o upload para o bucket `uploads`.
- Se usar pagamentos, faça um pedido de teste e confirme o recebimento do PDF.

Dados antigos do Railway/Supabase não são migrados por esse deploy. Se precisar
preservá-los, migre o PostgreSQL e copie os arquivos para os buckets antes de
alterar o domínio utilizado pelos clientes.
