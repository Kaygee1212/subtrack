// src/services/reminder.js
// รันทุกวันเวลา 09:00 น. — ตรวจสอบ subscription ที่ต้องแจ้งเตือน
const cron = require('node-cron');
const db = require('../models/db');
const { sendReminderEmail } = require('./email');

function startReminderCron() {
  // ทุกวันเวลา 09:00 น.
  cron.schedule('0 9 * * *', async () => {
    console.log('🔔 Running reminder cron...');
    try {
      // ดึง subscription ที่ถึงกำหนดต้องแจ้งเตือน
      // (subscribed_at + 30 วัน - reminder_days = วันนี้)
      const result = await db.query(`
        SELECT
          s.reminder_days,
          s.subscribed_at,
          u.email, u.name as user_name,
          p.id as platform_id, p.name as platform_name,
          p.icon, p.price_thb, p.unsubscribe_url
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        JOIN platforms p ON s.platform_id = p.id
        WHERE
          -- วันครบกำหนดต่ออายุ = subscribed_at + interval ของเดือนที่ผ่านไป
          -- แจ้งเตือน reminder_days วันก่อน
          DATE_PART('day',
            (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' + 
             (DATE_PART('day', s.subscribed_at) - 1) * INTERVAL '1 day')
            - NOW()
          ) = s.reminder_days
      `);

      console.log(`📬 Sending ${result.rows.length} reminder(s)...`);

      for (const row of result.rows) {
        const renewDate = new Date();
        renewDate.setDate(renewDate.getDate() + row.reminder_days);
        const renewDateStr = renewDate.toLocaleDateString('th-TH', {
          year: 'numeric', month: 'long', day: 'numeric'
        });

        try {
          await sendReminderEmail({
            to: row.email,
            userName: row.user_name,
            platform: {
              name: row.platform_name,
              icon: row.icon
            },
            unsubscribeUrl: row.unsubscribe_url,
            renewDate: renewDateStr,
            price: row.price_thb
          });
          console.log(`✅ Reminder sent to ${row.email} for ${row.platform_name}`);
        } catch (emailErr) {
          console.error(`❌ Failed to send reminder to ${row.email}:`, emailErr.message);
        }
      }
    } catch (err) {
      console.error('❌ Reminder cron error:', err);
    }
  }, { timezone: 'Asia/Bangkok' });

  console.log('⏰ Reminder cron scheduled (09:00 Bangkok)');
}

module.exports = { startReminderCron };
