const nodemailer = require('nodemailer');
const { getPrivateFileStream } = require('../config/storage');

function createTransporter() {
  const requiredSettings = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const missingSettings = requiredSettings.filter((setting) => !process.env[setting]);
  if (missingSettings.length) {
    throw new Error(`Configure as variáveis de e-mail: ${missingSettings.join(', ')}.`);
  }

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT inválida.');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendBookByEmail(order) {
  const books = Array.isArray(order.books) ? order.books : [order];
  if (!books.length || books.some((book) => !book.ebook_path)) {
    throw new Error(`Um PDF do pedido #${order.id} não está disponível.`);
  }

  const transporter = createTransporter();
  const safeFilename = (value) => String(value || 'livro').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const titles = books.map((book) => book.book_title || 'livro');
  const attachments = await Promise.all(books.map(async (book) => ({
    filename: `${safeFilename(book.book_title)}.pdf`,
    content: await getPrivateFileStream(book.ebook_path),
    contentType: 'application/pdf'
  })));
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: order.customer_email,
    subject: books.length === 1 ? `Seu livro "${titles[0]}" chegou!` : 'Seus livros chegaram!',
    text: `Olá, ${order.customer_name}!\n\nO pagamento foi confirmado. Anexamos ${books.length === 1 ? `o PDF de "${titles[0]}"` : 'os PDFs dos livros'} a este e-mail. Boa leitura!\n\nSe não encontrar esta mensagem na caixa de entrada, verifique também as pastas Spam ou Lixo eletrônico.\n\nNocturnal Chronicles`,
    attachments
  });
}

async function sendPasswordResetEmail({ email, name, code }) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Código para redefinir sua senha — Nocturnal Chronicles',
    text: `Olá, ${name}!\n\nRecebemos uma solicitação para redefinir a senha da sua conta Nocturnal Chronicles. Digite este código na página de recuperação:\n\n${code}\n\nO código expira em 10 minutos e só pode ser usado uma vez. Se você não solicitou a redefinição, ignore este e-mail.\n\nNocturnal Chronicles`
  });
}

module.exports = { sendBookByEmail, sendPasswordResetEmail };
