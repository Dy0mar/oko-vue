# OKO

Відеодзвінки на двох (максимум трьох) на WebRTC. Навчальний проєкт: ядро WebRTC пишемо самі.

Зараз є:
- вхід (email + пароль, реєстрація вимкнена);
- діагностика мережі `/diag`;
- адмінка `/admin`: STUN/TURN-сервери та звіти діагностики.

Дзвінок — наступний етап.

## Стек

| Частина | Технології |
|---|---|
| Frontend | Vue 3, PrimeVue 4 (MIT; v5 — комерційна ліцензія PrimeUI), Tailwind 4 + `tailwindcss-primeui`, vue-router, supabase-js |
| Backend | Supabase: Auth, Realtime (signaling), Postgres + RLS, Edge Functions (Deno) |
| Хостинг | Vercel (статичний SPA з `frontend/`) |
| Медіа | P2P WebRTC; STUN/TURN-сервери налаштовує адмін |

## Структура

```
.github/workflows/ci.yml      CI: oxlint, eslint, prettier, vue-tsc, build
frontend/
  src/api/                    supabase-клієнт і запити (iceServers, adminIceServers, diagReports)
  src/composables/useAuth.ts  сесія, isAdmin, signIn/signOut (singleton)
  src/router/                 маршрути + guard (meta: requiresAuth / requiresAdmin / guestOnly)
  src/pages/                  LoginPage, DiagPage, AdminPage
  src/components/             AppHeader, admin/*
  src/diagnostics/            probes (ICE/HTTP/media), ice (тест STUN/TURN), realtime
  src/assets/main.css         Tailwind + порядок CSS-шарів для PrimeVue
  vercel.json                 SPA rewrite + security headers
supabase/
  config.toml                 локальний стек (реєстрація вимкнена)
  migrations/                 схема БД, RLS, стартові сервери
  functions/ice-servers/      edge function: ICE-сервери для залогіненого юзера
```

Імпорти йдуть через alias `src/...`, а не `@/...`: так одразу видно, що це не стороння бібліотека.

## Ролі та безпека

- **Whitelist:** реєстрацію вимкнено, юзерів створює адмін (Studio → Authentication → Add user).
- **Адмін** визначається полем `app_metadata.role = "admin"`. Юзер змінити його не може. Роль потрапляє в JWT під час входу, тому **після зміни ролі треба перелогінитися**.
- **Фронтенд** (`isAdmin`) лише ховає UI. Справжній захист — **RLS** (`public.is_admin()`) і перевірка JWT в edge function.
- **`ice_servers`** бачить і змінює тільки адмін. Учасники отримують готовий список серверів через функцію `ice-servers`.
- **`diag_reports`:** юзер записує свій звіт (email береться з JWT), читає й видаляє звіти лише адмін.
- **Змінні `VITE_*` потрапляють у браузер.** Там можна тримати лише URL і **publishable**-ключ. Secret / service_role key — **ніколи**.

---

## Локальний запуск з нуля

Потрібно: Node `^22.18` або `>=24.12`, pnpm 12 (`corepack enable`), Docker.
Supabase CLI запускається через `npx supabase …` з **кореня** репо.

```bash
# 1. Залежності фронтенду
cd frontend && pnpm install && cd ..

# 2. Локальний Supabase (Postgres, Auth, Realtime, Studio). Міграції застосовуються автоматично.
npx supabase start
npx supabase status            # URL-и і ключі; машинно: npx supabase status -o env

# 3. Edge functions (окремий процес, тримати запущеним)
npx supabase functions serve

# 4. Env фронтенду: frontend/.env.local (шаблон — frontend/.env.example)
#    VITE_SUPABASE_URL=http://127.0.0.1:54321
#    VITE_SUPABASE_PUBLISHABLE_KEY=<Publishable key з `supabase status`>

# 5. Фронтенд
cd frontend && pnpm dev        # http://localhost:5173
```

Studio: http://127.0.0.1:54323.

### Юзери і адмін
1. Studio → Authentication → **Add user** (з позначкою «Auto confirm»).
2. Зробити адміном у SQL Editor, потім **перелогінитися**:
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
   where email = 'admin@example.com'
   returning email, raw_app_meta_data;
   ```
   Без `returning` Studio пише «No rows returned». Це не помилка: `update` просто нічого не повертає для показу.

### Команди фронтенду (`frontend/`)

| Команда | Що робить |
|---|---|
| `pnpm dev` | dev-сервер |
| `pnpm build` | type-check + production build |
| `pnpm lint` | oxlint + eslint **з автовиправленням** |
| `pnpm format` | prettier (запис) |
| `pnpm run check` | усе, що робить CI, без виправлень: oxlint, eslint, prettier, vue-tsc, build |

`pnpm ci` — вбудована команда pnpm (чиста інсталяція), не наш скрипт. Наш — `pnpm run check`.

### Міграції БД

```bash
npx supabase migration new <name>   # створює supabase/migrations/<timestamp>_<name>.sql
npx supabase migration up           # застосувати нові міграції до ЛОКАЛЬНОЇ бази (дані зберігаються)
npx supabase db reset               # ⚠️ перестворює локальну базу з нуля: юзери й дані зникнуть
```

Міграцію, вже застосовану в хмарі, не редагуй. Замість цього створюй нову.

---

## Деплой

### Supabase (хмарний проєкт `oko`, ref `zvoqfyivpaqiqahwcjmh`)

Один раз на машині:
```bash
npx supabase login
npx supabase link --project-ref zvoqfyivpaqiqahwcjmh   # спитає пароль БД (Dashboard → Project Settings → Database)
```

Деплой змін:
```bash
npx supabase migration list --remote      # що є локально і що вже в хмарі
npx supabase db push --remote --dry-run   # що саме буде застосовано
npx supabase db push --remote             # застосувати міграції
npx supabase functions deploy ice-servers # задеплоїти функцію
```

Варто знати:
- **У CLI 3 `db push` без `--remote` іде в ЛОКАЛЬНУ базу.**
- Якщо CLI запускає агент (Claude Code тощо), зміни в production вимагають `--yes`, і агент має спершу спитати тебе.
- **Не запускай `npx supabase config push`.** Він перезапише налаштування Auth у хмарі локальним `config.toml`, включно з `site_url = localhost`.

Налаштування Auth у хмарі робляться вручну, у Dashboard:
- Authentication → Sign In / Providers → **вимкнути «Allow new users to sign up»**;
- Authentication → URL Configuration → **Site URL** = адреса сайту на Vercel.

Секрети edge function (зараз не потрібні, лише для Cloudflare TURN):
```bash
npx supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...
# локально: supabase/functions/.env (шаблон — .env.example), потім перезапустити functions serve
```
`SUPABASE_URL` і ключі хмара підставляє у функції сама.

### Vercel
- **Root Directory:** `frontend` (Framework: Vite, визначиться автоматично).
- **Environment Variables:**
  - `VITE_SUPABASE_URL` = `https://zvoqfyivpaqiqahwcjmh.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY` = Dashboard → Project Settings → API Keys → Publishable
- Змінні `VITE_*` вшиваються в бандл **під час збірки**, тому після зміни env потрібен **Redeploy**.
- `vercel.json` віддає `index.html` для всіх маршрутів SPA і додає security headers.

---

## STUN/TURN

Сервери налаштовуються в **`/admin` → Сервери STUN/TURN**:
- **Статичний** сервер: адреси (`stun:`, `turn:`, `turns:`), для TURN також логін і пароль.
- **Cloudflare TURN:** тимчасові креденшели генеруються функцією з секретів `CF_TURN_*`. Зараз вимкнено, бо Cloudflare вимагає платіжну картку.
- Безкоштовні TURN без картки: Metered, ExpressTURN (поточні ліміти дивись на їхніх сайтах). Додаються як статичні.
- Кнопка ⚡ перевіряє кожну адресу окремо:
  - STUN працює ⇔ прийшов кандидат `srflx`;
  - TURN працює ⇔ прийшов кандидат `relay` у режимі «тільки relay».

Чому TURN через TLS на 443 (`turns:…:443?transport=tcp`) важливий: у мережах, де ріжуть медіатрафік (UDP/WebRTC), він виглядає як звичайний HTTPS. Сам медіапотік WebRTC завжди зашифрований (DTLS-SRTP), незалежно від STUN/TURN.

## Діагностика `/diag`

Юзер натискає «Запустити», сторінка перевіряє:
- інтернет;
- Supabase REST і Realtime;
- функцію `ice-servers`;
- кожну адресу STUN/TURN;
- тип NAT;
- (за кнопкою) камеру й мікрофон.

Звіт автоматично зберігається в `diag_reports`: його видно в `/admin` → Звіти діагностики.

---

## CI

`.github/workflows/ci.yml` запускається на push і PR у `master`: `pnpm install --frozen-lockfile` → oxlint → eslint → prettier --check → vue-tsc → build. Локально те саме робить `pnpm run check`.

## Якщо щось не так

| Симптом | Причина / що робити |
|---|---|
| Біла сторінка | Немає `VITE_SUPABASE_*` у `.env.local` / Vercel env, або старий бандл → Ctrl+Shift+R |
| `Function not found` локально | Не запущено `npx supabase functions serve` |
| `functions serve` впав з `exit 137` | Docker вбив контейнер (найчастіше через пам'ять). Запустити знову |
| Адмінки не видно після зміни ролі | Перелогінитись: роль у JWT оновлюється під час входу |
| `db push` «Local database is up to date», а в хмарі нічого | Забув `--remote` |
| Компоненти темні, фон світлий | `darkModeSelector` має бути `.app-dark`, клас стоїть на `<html>` в `index.html` |
