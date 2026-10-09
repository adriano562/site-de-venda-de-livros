# Configuração de Pix e entrega de e-books

1. Configure `MERCADOPAGO_ACCESS_TOKEN` com o Access Token da aplicação no painel de desenvolvedores do Mercado Pago. Use credenciais de teste antes de habilitar vendas reais.
2. Configure o SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM`) para o endereço que enviará os livros. `SMTP_SECURE` deve ser `true` para TLS implícito; a porta 465 também ativa essa opção.
3. Cadastre no painel do Mercado Pago a URL `https://SEU-DOMINIO/api/orders/webhook/mercadopago` para notificações do tipo **Pagamentos**. Copie a chave secreta de assinatura do webhook para `MERCADOPAGO_WEBHOOK_SECRET`. Opcionalmente, configure `MERCADOPAGO_NOTIFICATION_URL` com essa mesma URL para associá-la diretamente a cada pagamento.
4. Reinicie o servidor e, no painel `/admin`, carregue o PDF de cada livro. O PDF é armazenado em uma pasta oculta, separada dos uploads públicos, e não é disponibilizado por URL.
5. Teste o fluxo com credenciais de teste e confira a entrega no endereço de e-mail informado no checkout antes de ativar as credenciais de produção.

O PDF só é enviado após o servidor validar a assinatura do webhook e confirmar diretamente com o Mercado Pago que o pagamento está aprovado e corresponde ao valor e aos pedidos criados. Se o envio de e-mail falhar, o webhook retorna erro para permitir uma nova tentativa; o pedido pode também ser reenviado marcando-o como pago no painel depois de confirmar o pagamento.
