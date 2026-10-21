# MOTOVICH — план готовности к Google Play и уведомлениям

Последняя проверка репозитория: 21 октября 2026 г. Статус отражает код и документы в GitHub, а не живую конфигурацию Supabase или Google Play Console.

## Что уже подготовлено в репозитории
- PWA-манифест с постоянным id, абсолютными путями GitHub Pages и PNG-иконками 192×192/512×512, включая maskable.
- Service worker с новой версией кэша и проверками CI.
- Отдельные страницы политики конфиденциальности и удаления аккаунта; ссылки доступны в настройках приложения.
- Серверная функция удаления Supabase-аккаунта с проверкой JWT; пользователь удаляет только собственный аккаунт.
- Web Push-клиент, user-scoped test sender, cron-based per-task scheduler and a server-only deduplication ledger. Real delivery still requires applying migrations, a live Supabase project, server secrets, a manually uploaded cloud snapshot and an enabled cron schedule.

## Важно перед Google Play
1. **Новый Android-релиз должен target Android 16 / API 36 или выше.** Google Play применяет это требование к новым приложениям и обновлениям с 31 августа 2026 г.: https://support.google.com/googleplay/android-developer/answer/11926878
2. **Для новых личных аккаунтов Play Console, созданных после 13 ноября 2023 г., production-доступ требует закрытого теста с минимум 12 тестировщиками, непрерывно включёнными в тест не менее 14 дней**, а затем заявки на production access: https://support.google.com/googleplay/android-developer/answer/14151465
3. Для PWA в полноэкранной Android-оболочке обычно используют Trusted Web Activity (Bubblewrap). Для доверенного полноэкранного режима нужны Digital Asset Links и отпечаток SHA-256 ключа подписи, используемого Google Play App Signing: https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
4. **Текущий проект размещён на GitHub Pages по пути** https://dmwwiin-beep.github.io/motovich-opt-site/motovich-app/. Digital Asset Links для TWA должны обслуживаться по корневому URL origin: https://dmwwiin-beep.github.io/.well-known/assetlinks.json. Файл в /motovich-opt-site/.well-known/ этого не заменит. У репозитория сейчас нет корневого сайта dmwwiin-beep.github.io, поэтому для проверенной TWA-оболочки потребуется подключить собственный домен либо настроить корневой GitHub Pages-сайт. Не публикуйте фиктивный assetlinks.json и не подставляйте случайный отпечаток.
5. Android package ID фиксируется при первой публикации и должен быть выбран разработчиком. Предлагаемое имя для обсуждения: app.motovich.productivity; до первого AAB необходимо проверить доступность и окончательно закрепить ID.
6. Политика конфиденциальности и раздел Data safety в Play Console должны описывать реальные подключения, используемые данные и обработку аккаунтов. Страницы в репозитории — черновик, который необходимо сверить с фактической конфигурацией backend и контактным адресом.

## План на завтра

### A. Supabase и уведомления
- Создать Supabase-проект и включить email/password auth.
- В SQL Editor выполнить по порядку все три миграции: 202610210001_motovich_cloud.sql, 202610210002_motovich_push.sql, 202610210003_motovich_push_deliveries.sql; затем выполнить supabase/tests/manual_security_checks.sql.
- Установить Edge Function secrets на сервере: OPENAI_API_KEY (только для AI, опционально), OPENAI_MODEL, MOTOVICH_ALLOWED_ORIGIN=https://dmwwiin-beep.github.io, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:..., MOTOVICH_PUSH_CRON_SECRET (случайный секрет не короче 32 байт). SUPABASE_URL и legacy SUPABASE_SERVICE_ROLE_KEY Supabase передаёт функциям автоматически; не пытайся установить ключ с префиксом SUPABASE_ через secrets set. Ничего секретного не помещать в клиентский код, GitHub Pages или документы.
- Развернуть функции: supabase functions deploy coach, supabase functions deploy push-send, supabase functions deploy push-test, supabase functions deploy push-schedule, supabase functions deploy delete-account.
- В приложении открыть Настройки → Облако и синхронизация: ввести Project URL, публичный anon/publishable key и VAPID public key; зарегистрировать/войти, нажать «Включить уведомления на этом устройстве». Разрешение браузера — только этап подписки, оно не запускает отправку само по себе.
- Выполнить шаблон supabase/setup/push-schedule-cron.sql (подставить project ref и тот же секрет, который сохранён как MOTOVICH_PUSH_CRON_SECRET) и проверить, что cron активен. Скрипт создаёт расписание каждую минуту для push-schedule с заголовком x-motovich-cron-secret. Планировщик использует только последнюю вручную выгруженную копию задач, часовой пояс устройства и задачу, в которой есть и дата, и время. После изменения задач снова нажми «Отправить локальные данные». Журнал на сервере предотвращает повтор одного и того же напоминания. push-send остаётся общим внутренним отправителем, push-test проверяет личную доставку.
- Выполнить контрольную отправку из защищённого backend-процесса и подтвердить, что уведомление приходит на Android при закрытой PWA.

### B. Android packaging / Play Console
- Утвердить постоянный package ID и домен/путь TWA.
- Исправить корневую Digital Asset Links проблему выше; только после создания подписанной сборки добавить корректный SHA-256 fingerprint.
- На рабочем компьютере с Node.js и Android SDK выполнить Bubblewrap init для реального Web Manifest, затем сборку release AAB, установить на реальное Android-устройство и проверить офлайн, навигацию, ссылки, уведомления и обновления. Секретный keystore хранить вне репозитория.
- Подготовить listing: название MOTOVICH; краткое описание «Планируй день, управляй задачами и привычками, фокусируйся и отслеживай прогресс»; полное описание, реальные Android-скриншоты, иконку, контакт разработчика, privacy policy URL, account deletion URL, Data safety, app access instructions и content rating.
- Загрузить AAB в Internal testing для ранней проверки. Если на аккаунте применяется правило закрытого теста, запустить Closed testing и собрать 12 непрерывных тестировщиков на 14 дней до заявки на production-доступ.

Перед отправкой в Closed testing используй [PLAY-TEST-PLAN.md](./PLAY-TEST-PLAN.md): в нём таблица проверок, сценарии Push, календаря, резервной копии, удаления данных и черновик Data safety.

## Чего ещё нет / не утверждается
- В репозитории нет собранного подписанного AAB, keystore, реального Digital Asset Links fingerprint или опубликованного релиза Play Console.
- Не настроены Supabase project secrets, миграции в реальном проекте и серверный cron, поэтому push-доставка не станет активной только от включения разрешения.
- Не выполнен реальный тест на Android-устройстве и в Google Play Console.
- Уникальность app.motovich.productivity, название листинга и контакт разработчика нужно проверить до первой отправки.


## Blocking release requirement: real support contact

A verified developer support email has not been provided in the repository context, so it has intentionally not been invented. Before public release:
- replace the warning contact text in `privacy.html` and `account-deletion.html` with the actual support email;
- make the external deletion request a direct, working link that does not require installing or signing into the app;
- use the same support contact in Play Console and the public listing;
- test the deletion URL in a private browser window without an app session.

Google Play's account-deletion policy requires a discoverable in-app path and an external web resource where a user can request deletion even after uninstalling: https://support.google.com/googleplay/android-developer/answer/10144311


## Пошаговая сборка Android

Подробные команды, проверка API 36, Digital Asset Links, подпись и smoke-test собраны в [BUILD-ANDROID.md](./android/BUILD-ANDROID.md).


## Дополнительный риск для аккаунта с платежным профилем России

Если платежный профиль Google Play и банковский счёт для выплат зарегистрированы в России, проверь официальное ограничение для разработчиков из России. Google сообщает, что с 26 декабря 2024 года перестала обрабатывать выплаты на банковские счета, открытые в России; новые бесплатные приложения при этом могут публиковаться, но монетизацию с таким счётом не следует считать доступной. Условия зависят от фактической страны платёжного профиля и могут меняться: https://support.google.com/googleplay/android-developer/answer/15685001


### Generate the VAPID pair

On a trusted computer run `npm install --global web-push`, then `web-push generate-vapid-keys --json`. Store the public key as `VAPID_PUBLIC_KEY` (also entered in the app) and private key only as server-side `VAPID_PRIVATE_KEY`. Keep one permanent pair; changing it breaks existing subscriptions. Official CLI notes: https://github.com/web-push-libs/web-push#command-line

## Optional deployment through GitHub Actions

For a manual deploy helper, see Actions → “Deploy MOTOVICH Supabase backend (manual)”. Required repository secrets: SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, MOTOVICH_PUSH_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. OPENAI_API_KEY is optional; OPENAI_MODEL can be a repository variable. Do not add a SUPABASE_SERVICE_ROLE_KEY secret because Supabase injects it into its hosted functions. The workflow applies migrations and deploys Edge Functions; it intentionally leaves the Vault cron schedule as a separate manual step.
