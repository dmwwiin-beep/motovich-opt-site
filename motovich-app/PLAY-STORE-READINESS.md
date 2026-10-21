# MOTOVICH — план готовности к Google Play и уведомлениям

Последняя проверка репозитория: 21 октября 2026 г. Статус отражает код и документы в GitHub, а не живую конфигурацию Supabase или Google Play Console.

## Что уже подготовлено в репозитории
- PWA-манифест с постоянным id, абсолютными путями GitHub Pages и PNG-иконками 192×192/512×512, включая maskable.
- Service worker с новой версией кэша и проверками CI.
- Отдельные страницы политики конфиденциальности и удаления аккаунта; ссылки доступны в настройках приложения.
- Серверная функция удаления Supabase-аккаунта с проверкой JWT; пользователь удаляет только собственный аккаунт.
- Web Push-клиент, хранилище подписок под RLS и внутренний sender — но реальная доставка требует реального Supabase-проекта, секретов и настроенного расписания.

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
- В SQL Editor выполнить по порядку миграции 202610210001_motovich_cloud.sql и 202610210002_motovich_push.sql; затем выполнить supabase/tests/manual_security_checks.sql.
- Установить Edge Function secrets на сервере: OPENAI_API_KEY (только для AI), OPENAI_MODEL, MOTOVICH_ALLOWED_ORIGIN=https://dmwwiin-beep.github.io, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:..., MOTOVICH_PUSH_CRON_SECRET (случайный секрет не короче 32 байт), SUPABASE_SERVICE_ROLE_KEY. Ничего из секретов не помещать в клиентский код, GitHub Pages или этот файл.
- Развернуть функции: supabase functions deploy coach, supabase functions deploy push-send, supabase functions deploy delete-account.
- В приложении открыть Настройки → Облако и синхронизация: ввести Project URL, публичный anon/publishable key и VAPID public key; зарегистрировать/войти, нажать «Включить уведомления на этом устройстве». Разрешение браузера — только этап подписки, оно не запускает отправку само по себе.
- Настроить серверный cron/планировщик для push-send с заголовком x-motovich-cron-secret. Сейчас эта функция отправляет общую напоминательную нотификацию всем подписанным устройствам; персональные напоминания на время конкретной задачи требуют отдельного сервера планирования и актуального облачного состояния задач.
- Выполнить контрольную отправку из защищённого backend-процесса и подтвердить, что уведомление приходит на Android при закрытой PWA.

### B. Android packaging / Play Console
- Утвердить постоянный package ID и домен/путь TWA.
- Исправить корневую Digital Asset Links проблему выше; только после создания подписанной сборки добавить корректный SHA-256 fingerprint.
- На рабочем компьютере с Node.js и Android SDK выполнить Bubblewrap init для реального Web Manifest, затем сборку release AAB, установить на реальное Android-устройство и проверить офлайн, навигацию, ссылки, уведомления и обновления. Секретный keystore хранить вне репозитория.
- Подготовить listing: название MOTOVICH; краткое описание «Планируй день, управляй задачами и привычками, фокусируйся и отслеживай прогресс»; полное описание, реальные Android-скриншоты, иконку, контакт разработчика, privacy policy URL, account deletion URL, Data safety, app access instructions и content rating.
- Загрузить AAB в Internal testing для ранней проверки. Если на аккаунте применяется правило закрытого теста, запустить Closed testing и собрать 12 непрерывных тестировщиков на 14 дней до заявки на production-доступ.

## Чего ещё нет / не утверждается
- В репозитории нет собранного подписанного AAB, keystore, реального Digital Asset Links fingerprint или опубликованного релиза Play Console.
- Не настроены Supabase project secrets и серверный cron, поэтому push-доставка не активна лишь от факта включения разрешения.
- Не выполнен реальный тест на Android-устройстве и в Google Play Console.
- Уникальность app.motovich.productivity, название листинга и контакт разработчика нужно проверить до первой отправки.
