# SubTrack — คู่มือ Deploy ฉบับสมบูรณ์

จัดการ Subscription ทุกแพลตฟอร์มในที่เดียว พร้อมระบบ Auth, ชำระเงิน, และแจ้งเตือน

---

## โครงสร้างโปรเจกต์

```
subtrack/
├── backend/
│   ├── src/
│   │   ├── index.js              ← Entry point
│   │   ├── middleware/auth.js    ← JWT middleware
│   │   ├── models/
│   │   │   ├── db.js             ← PostgreSQL connection
│   │   │   └── migrate.js        ← สร้าง tables
│   │   ├── routes/
│   │   │   ├── auth.js           ← Register / Login
│   │   │   ├── subscriptions.js  ← CRUD subscriptions
│   │   │   └── payment.js        ← Omise payment
│   │   └── services/
│   │       ├── email.js          ← SendGrid emails
│   │       └── reminder.js       ← Cron job แจ้งเตือน
│   ├── package.json
│   └── .env.example              ← คัดลอกเป็น .env
└── frontend/
    └── index.html                ← App ทั้งหมดในไฟล์เดียว
```

---

## ขั้นตอน Deploy (ทำครั้งเดียว ~30 นาที)

### Step 1 — สมัคร Services ฟรี

| Service | ใช้ทำอะไร | ลิงก์สมัคร |
|---|---|---|
| **Supabase** | Database PostgreSQL | https://supabase.com |
| **Railway** | Host Backend | https://railway.app |
| **Vercel** | Host Frontend | https://vercel.com |
| **SendGrid** | ส่งอีเมล | https://sendgrid.com |
| **Omise/Opn** | รับชำระเงิน | https://opn.ooo |

---

### Step 2 — ตั้งค่า Database (Supabase)

1. สมัคร Supabase → สร้าง Project ใหม่
2. ไปที่ **Settings → Database → Connection string**
3. คัดลอก URI (postgresql://...)
4. เปิด **SQL Editor** แล้ว run โค้ดทั้งหมดจากไฟล์ `backend/src/models/migrate.js`
   (ส่วนที่อยู่ใน backtick ของตัวแปร `schema`)

---

### Step 3 — Deploy Backend (Railway)

```bash
# 1. ติดตั้ง dependencies
cd backend
npm install

# 2. คัดลอก env
cp .env.example .env
# แก้ไขค่าใน .env ทุกบรรทัด

# 3. ทดสอบใน local ก่อน
npm run dev
# เปิด http://localhost:3001/health ควรเห็น {"status":"ok"}

# 4. Push ขึ้น GitHub แล้ว connect กับ Railway
# Railway จะ deploy อัตโนมัติ
```

**Railway Environment Variables** — ใส่ค่าเดียวกับ .env ใน Railway Dashboard

---

### Step 4 — Deploy Frontend (Vercel)

1. เปิดไฟล์ `frontend/index.html`
2. แก้บรรทัด:
   ```javascript
   const API_URL = 'http://localhost:3001/api';
   ```
   เปลี่ยนเป็น URL ของ Railway ที่ได้มา เช่น:
   ```javascript
   const API_URL = 'https://subtrack-backend.railway.app/api';
   ```
3. Upload ไฟล์ขึ้น Vercel หรือ Netlify Drop

---

### Step 5 — เปิดใช้ Omise (รับเงินจริง)

1. สมัคร https://opn.ooo → กรอกข้อมูลธุรกิจ
2. ได้รับ **Public Key** และ **Secret Key**
3. ใส่ใน .env
4. ติดตั้ง library:
   ```bash
   npm install omise
   ```
5. ในไฟล์ `backend/src/routes/payment.js` → **ปลด comment** บรรทัดที่มี `omise.charges.create`
6. ในไฟล์ `frontend/index.html` → เพิ่ม Omise.js script ก่อน `</body>`:
   ```html
   <script src="https://cdn.omise.co/omise.js"></script>
   ```
   แล้วใช้ `OmiseCard.open()` เพื่อสร้าง token ก่อนส่ง API

---

### Step 6 — ตั้งค่า SendGrid (ส่งอีเมลจริง)

1. สมัคร SendGrid → ยืนยัน sender email
2. ไปที่ **Settings → API Keys → Create API Key**
3. ใส่ใน .env:
   ```
   SENDGRID_API_KEY=SG.xxxx
   SENDGRID_FROM_EMAIL=noreply@yourdomain.com
   ```

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | /api/auth/register | สมัครสมาชิก |
| POST | /api/auth/login | เข้าสู่ระบบ |
| GET | /api/auth/me | ข้อมูล user ปัจจุบัน |

### Subscriptions
| Method | Path | Description |
|---|---|---|
| GET | /api/subscriptions | รายการ sub ของ user |
| POST | /api/subscriptions/:id | Subscribe แพลตฟอร์ม |
| DELETE | /api/subscriptions/:id | Unsubscribe (คืน URL) |
| PATCH | /api/subscriptions/:id/reminder | ตั้งวันแจ้งเตือน |
| GET | /api/subscriptions/platforms/all | แพลตฟอร์มทั้งหมด |

### Payment
| Method | Path | Description |
|---|---|---|
| POST | /api/payment/charge | ชำระบัตรเครดิต |
| POST | /api/payment/promptpay | สร้าง QR PromptPay |
| GET | /api/payment/history | ประวัติการชำระ |

---

## ค่าใช้จ่ายโดยประมาณ

| Service | Free Tier | เสียเงินเมื่อ |
|---|---|---|
| Supabase | 500MB, 2 projects | เกิน 500MB |
| Railway | $5 credit/เดือน | เกิน free tier |
| Vercel | ฟรีไม่จำกัด | ต้องการ custom domain |
| SendGrid | 100 emails/วัน | เกิน 100/วัน |
| Omise | ฟรีสมัคร | 3.65% + ฿15 ต่อ transaction |

**รวม: ฟรีแทบทั้งหมดในช่วงเริ่มต้น** 🎉

---

## ฟีเจอร์ที่มีในระบบ

- ✅ Register / Login ด้วย JWT
- ✅ Subscribe / Unsubscribe แพลตฟอร์ม
- ✅ ลิงก์ Unsubscribe จริงของแต่ละแพลตฟอร์ม (แสดงบนการ์ด)
- ✅ แจ้งเตือนทางอีเมลก่อนต่ออายุ (Cron job ทุกวัน 09:00)
- ✅ อีเมลแจ้งเตือนมีปุ่มคลิกไปหน้า Unsubscribe โดยตรง
- ✅ ชำระด้วยบัตรเครดิต (ผ่าน Omise)
- ✅ ชำระด้วย QR PromptPay (ผ่าน Omise)
- ✅ ส่งใบเสร็จทางอีเมล (SendGrid)
- ✅ ประวัติการชำระเงิน

---

*หากติดปัญหา deploy ขั้นตอนไหน สามารถถามได้เลยครับ*
