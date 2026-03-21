// src/services/email.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = {
  email: process.env.SENDGRID_FROM_EMAIL,
  name: process.env.SENDGRID_FROM_NAME || 'SubTrack'
};

// ── ส่งอีเมลยืนยันการชำระเงิน ──
async function sendReceiptEmail({ to, userName, platforms, total, transactionId, date }) {
  const platformRows = platforms.map(p =>
    `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #1e1e2e;">${p.icon} ${p.name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #1e1e2e;text-align:right;color:#00d4aa;font-weight:700;">฿${p.price_thb}/เดือน</td>
    </tr>`
  ).join('');

  const html = `
  <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',sans-serif;color:#f0f0f8;">
    <div style="max-width:560px;margin:40px auto;background:#12121a;border-radius:20px;overflow:hidden;border:1px solid #2a2a3a;">
      <div style="background:linear-gradient(135deg,#7c6fff,#ff6b9d);padding:32px;text-align:center;">
        <h1 style="margin:0;font-size:2rem;color:white;letter-spacing:-1px;">SubTrack</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:0.9rem;">ใบเสร็จการชำระเงิน</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#6b6b8a;font-size:0.85rem;margin-bottom:6px;">สวัสดีคุณ ${userName}</p>
        <p style="margin:0 0 24px;font-size:1.1rem;">การชำระเงินของคุณสำเร็จแล้ว ✅</p>
        <table style="width:100%;border-collapse:collapse;">
          ${platformRows}
          <tr>
            <td style="padding:16px 0 0;font-weight:700;font-size:1.1rem;">รวมทั้งหมด</td>
            <td style="padding:16px 0 0;text-align:right;font-weight:800;font-size:1.3rem;color:#ff6b9d;">฿${total}/เดือน</td>
          </tr>
        </table>
        <div style="margin-top:24px;background:#1a1a26;border-radius:12px;padding:16px;font-size:0.82rem;color:#6b6b8a;">
          เลขที่อ้างอิง: <strong style="color:#a99fff;">${transactionId}</strong><br>
          วันที่: ${date}
        </div>
      </div>
      <div style="padding:20px 32px;border-top:1px solid #2a2a3a;text-align:center;font-size:0.75rem;color:#6b6b8a;">
        SubTrack · จัดการ Subscription ทุกแพลตฟอร์มในที่เดียว
      </div>
    </div>
  </body></html>`;

  return sgMail.send({
    to,
    from: FROM,
    subject: `✅ ใบเสร็จ SubTrack — ฿${total}/เดือน`,
    html
  });
}

// ── ส่งอีเมลแจ้งเตือนก่อนต่ออายุ (พร้อมลิงก์ unsubscribe) ──
async function sendReminderEmail({ to, userName, platform, unsubscribeUrl, renewDate, price }) {
  const html = `
  <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',sans-serif;color:#f0f0f8;">
    <div style="max-width:560px;margin:40px auto;background:#12121a;border-radius:20px;overflow:hidden;border:1px solid #2a2a3a;">
      <div style="background:linear-gradient(135deg,#1a1a26,#2a2a3a);padding:32px;text-align:center;">
        <div style="font-size:3rem;margin-bottom:12px;">${platform.icon}</div>
        <h2 style="margin:0;font-size:1.4rem;color:white;">${platform.name}</h2>
        <p style="margin:8px 0 0;color:#ff6b9d;font-size:0.9rem;">⏰ แจ้งเตือนการต่ออายุ</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#6b6b8a;margin-bottom:6px;">สวัสดีคุณ ${userName}</p>
        <p style="margin:0 0 20px;font-size:1rem;line-height:1.6;">
          Subscription <strong>${platform.name}</strong> ของคุณจะต่ออายุอัตโนมัติในวันที่ <strong style="color:#7c6fff;">${renewDate}</strong> 
          ในราคา <strong style="color:#ff6b9d;">฿${price}/เดือน</strong>
        </p>

        <div style="background:#1a1a26;border-radius:14px;padding:20px;margin-bottom:20px;">
          <p style="margin:0 0 8px;font-size:0.85rem;color:#6b6b8a;">หากต้องการยกเลิก กรุณาดำเนินการก่อนวันที่ ${renewDate}</p>
          <a href="${unsubscribeUrl}"
             style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#ff8fb3);
                    color:white;text-decoration:none;padding:12px 24px;border-radius:10px;
                    font-weight:700;font-size:0.9rem;margin-top:8px;">
            🚫 ยกเลิก ${platform.name} ที่นี่
          </a>
        </div>

        <p style="font-size:0.8rem;color:#6b6b8a;line-height:1.6;">
          หากคุณต้องการ Subscribe ต่อไป ไม่ต้องทำอะไร ระบบจะต่ออายุอัตโนมัติ<br>
          จัดการ Subscription ทั้งหมดได้ที่ <a href="${process.env.FRONTEND_URL}" style="color:#7c6fff;">SubTrack Dashboard</a>
        </p>
      </div>
      <div style="padding:20px 32px;border-top:1px solid #2a2a3a;text-align:center;font-size:0.75rem;color:#6b6b8a;">
        คุณได้รับอีเมลนี้เพราะคุณใช้ SubTrack · <a href="${process.env.FRONTEND_URL}/unsubscribe-email" style="color:#6b6b8a;">ยกเลิกการแจ้งเตือน</a>
      </div>
    </div>
  </body></html>`;

  return sgMail.send({
    to,
    from: FROM,
    subject: `⏰ ${platform.name} จะต่ออายุในอีก 3 วัน — ฿${price}/เดือน`,
    html
  });
}

module.exports = { sendReceiptEmail, sendReminderEmail };
