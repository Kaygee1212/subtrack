const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL || 'onboarding@resend.dev';

async function sendReceiptEmail({ to, userName, platforms, total, transactionId, date }) {
  const platformRows = platforms.map(p =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${p.icon} ${p.name}</td>
     <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#00d4aa"><b>฿${p.price_thb}/เดือน</b></td></tr>`
  ).join('');
  await resend.emails.send({
    from: FROM, to,
    subject: `✅ ใบเสร็จ SubTrack — ฿${total}/เดือน`,
    html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h2 style="color:#7c6fff">SubTrack</h2>
      <p>สวัสดีคุณ ${userName} การชำระเงินสำเร็จแล้ว ✅</p>
      <table style="width:100%">${platformRows}</table>
      <p><b>รวม: ฿${total}/เดือน</b></p>
      <p style="color:#999">เลขอ้างอิง: ${transactionId} · ${date}</p>
    </div>`
  });
}

async function sendReminderEmail({ to, userName, platform, unsubscribeUrl, renewDate, price }) {
  await resend.emails.send({
    from: FROM, to,
    subject: `⏰ ${platform.name} จะต่ออายุในอีก 3 วัน — ฿${price}/เดือน`,
    html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h2>${platform.icon} ${platform.name}</h2>
      <p>สวัสดีคุณ ${userName}</p>
      <p>Subscription <b>${platform.name}</b> จะต่ออายุวันที่ <b>${renewDate}</b> ราคา <b>฿${price}/เดือน</b></p>
      <a href="${unsubscribeUrl}" style="display:inline-block;background:#ff4d6d;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">
        🚫 ยกเลิก ${platform.name}
      </a>
    </div>`
  });
}

module.exports = { sendReceiptEmail, sendReminderEmail };