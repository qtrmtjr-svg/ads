# برنامج أبوظبي للدعم الاجتماعي — الحاسبة الإلكترونية وتقديم الطلبات

موقع بسيط (Node.js + Express) يحتوي على:

- **`/`** — الصفحة الرئيسية وحاسبة الدعم الإلكترونية
- **`/apply.html`** — نموذج تقديم طلب الدعم
- **`/confirm.html`** — صفحة تأكيد البيانات وإرسال الطلب
- **`/admin.html`** — لوحة تحكم لفريق العمل (محمية بكلمة مرور)

البيانات المُقدَّمة تُخزَّن في ملف `data/applications.json` على الخادم عن طريق واجهة API حقيقية (وليس أي شيء خاص بمعاينة Claude)، فتقدر تنشر المشروع على أي مزود استضافة Node.js عادي.

## التشغيل محليًا

```bash
npm install
npm start
```

الموقع هيشتغل على `http://localhost:3000` (أو المنفذ (port) اللي في متغير البيئة `PORT`).

## كلمة مرور لوحة التحكم

القيمة الافتراضية: `admin123`

لتغييرها، حدد متغير البيئة `ADMIN_PASSWORD` قبل التشغيل:

```bash
ADMIN_PASSWORD=your_new_password npm start
```

على Railway، ضيف المتغير ده من تبويب **Variables** في المشروع.

## رفع المشروع على GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## النشر على Railway

1. من [railway.app](https://railway.app)، اختار **New Project → Deploy from GitHub repo**.
2. اختار الريبو اللي رفعته.
3. Railway بيكتشف تلقائيًا إن المشروع Node.js (بيقرأ `package.json`) ويشغّل `npm start`.
4. (اختياري) من تبويب **Variables**، ضيف `ADMIN_PASSWORD` بكلمة مرور خاصة بيك.
5. بعد النشر، Railway هيعطيك رابط عام (Domain) — الموقع هيبقى شغال عليه بكل صفحاته (`/apply.html`, `/confirm.html`, `/admin.html`).

## بنية المشروع

```
.
├── server.js          # الخادم (Express) + واجهة API
├── package.json
├── Procfile           # لتشغيل الخادم على Railway/Heroku
├── railway.json        # إعدادات النشر على Railway
├── public/
│   ├── index.html      # الصفحة الرئيسية + الحاسبة
│   ├── apply.html       # نموذج تقديم الطلب
│   ├── confirm.html     # تأكيد البيانات
│   └── admin.html       # لوحة التحكم
└── data/
    └── applications.json  # يُنشأ تلقائيًا، يخزن الطلبات المُقدَّمة
```

## واجهة API

| Method | Path                  | الوصف                                              |
|--------|------------------------|-----------------------------------------------------|
| POST   | `/api/applications`    | إرسال طلب جديد (من صفحة التأكيد)                    |
| GET    | `/api/applications`    | جلب كل الطلبات (يتطلب رأس `x-admin-password`)       |
| POST   | `/api/admin/verify`    | التحقق من كلمة مرور لوحة التحكم                      |
| POST   | `/api/heartbeat`       | نبضة دورية لتتبع الزيارات النشطة                     |
| GET    | `/api/active-visits`   | عدد الزيارات النشطة حاليًا                           |

## ملاحظة عن التخزين

البيانات بتتخزن في ملف JSON على القرص (`data/applications.json`)، وهي طريقة تخزين بسيطة تكفي للتجربة والاستخدام الصغير. لو الموقع هيستقبل عدد كبير من الطلبات فعليًا، الأفضل الترقية لقاعدة بيانات حقيقية (مثل PostgreSQL، وRailway بيوفرها كإضافة (plugin) بضغطة واحدة).
