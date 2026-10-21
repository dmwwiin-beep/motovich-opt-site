# MOTOVICH — сборка Android / AAB

Этот runbook готовит сборку из текущей PWA, но **не содержит готового подписанного AAB**. Сначала нужно закрыть origin и подпись TWA.

## 0. Не начинай финальную сборку, пока не решён origin

Сейчас PWA: `https://dmwwiin-beep.github.io/motovich-opt-site/motovich-app/`.

Для полноэкранной Trusted Web Activity файл Digital Asset Links должен открываться по корню того же origin:
`https://dmwwiin-beep.github.io/.well-known/assetlinks.json`.

В доступных репозиториях нет отдельного корневого сайта `dmwwiin-beep.github.io`, поэтому этот URL не обслуживается текущей страницей проекта. Нужно создать корневой GitHub Pages сайт в репозитории `dmwwiin-beep.github.io` (этого репозитория пока нет) или подключить свой домен и перенести PWA на него. Не кладите `assetlinks.json` в `motovich-opt-site/.well-known/`: это другой URL.

## 1. Проверить PWA до генерации Android-проекта

На компьютере с Node.js:

```bash
npm install --global @bubblewrap/cli
bubblewrap doctor
bubblewrap validate --url=https://dmwwiin-beep.github.io/motovich-opt-site/motovich-app/
```

Утилита Bubblewrap генерирует Android TWA-проект из веб-манифеста. Официальная документация: https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md

Если проверка сообщает о Digital Asset Links / TWA verification, не игнорируй предупреждение: сначала реши пункт 0.

## 2. Инициализировать проект

После решения origin:

```bash
bubblewrap init --manifest=https://<APP-ORIGIN>/<APP-PATH>/manifest.webmanifest --directory=./motovich-android
cd motovich-android
bubblewrap doctor
```

Во время инициализации:
- выбери окончательный package ID. `app.motovich.productivity` — только предложение; проверь доступность и закрепи его до первой публикации;
- используй актуальное имя приложения MOTOVICH и маскируемую PNG-иконку;
- создай signing keystore и надёжно сохрани файл и пароли вне GitHub;
- не коммить `twa-manifest.json` или keystore. В `motovich-app/android/.gitignore` уже перечислены типовые исключения.

Скопируй из `motovich-app/android/twa-manifest.example.json` нужные брендовые значения, но не копируй старый host/startUrl вслепую, если сменился домен или путь.

## 3. Проверить Android target API

Перед сборкой открой сгенерированный Android Gradle-файл и убедись, что `targetSdkVersion` / `targetSdk` — **36 или выше**, а сборка использует совместимую версию SDK/Build Tools. С 31 августа 2026 года новые приложения и обновления Google Play должны target Android 16 / API 36+. Проверяй финальный AAB, а не только исходный манифест:
https://support.google.com/googleplay/android-developer/answer/11926878

```bash
bubblewrap build
```

Bubblewrap должен сформировать подписанный APK для тестирования и App Bundle `.aab`. Если использован флаг пропуска PWA-валидации, возвращайся к обычной проверке и не отправляй такой артефакт в магазин как готовый релиз.

## 4. Digital Asset Links и Play App Signing

1. После сборки Bubblewrap формирует пример `assetlinks.json` с отпечатком локального signing certificate.
2. Если включён Google Play App Signing, найди **SHA-256 сертификата подписи приложения** в Play Console → App integrity. Не путай его с upload certificate.
3. Положи корректный JSON по адресу `https://<APP-ORIGIN>/.well-known/assetlinks.json` и проверь, что он доступен без авторизации и возвращает HTTP 200.
4. Проверь, что package ID и fingerprint совпадают с приложением в Play Console; затем снова выполни `bubblewrap validate --url=...` и тест на реальном Android-устройстве.

Официальное руководство TWA: https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2

## 5. До отправки в Google Play

- Установить APK на реальный Android-телефон: запуск, навигация, ориентация, клавиатура и микрофон, офлайн, обновление кэша, открытие ссылок, системное разрешение Push.
- После развёртывания Supabase проверить тестовое уведомление и реальное напоминание по задаче с датой и временем, когда приложение закрыто.
- Создать карточку магазина из `PLAY-STORE-LISTING.md`; нужны иконка 512×512, feature graphic 1024×500 и как минимум два корректных скриншота. Скриншоты должны показывать актуальное приложение, а не придуманный интерфейс.
- Подтвердить реальный email поддержки и работающую внешнюю ссылку запроса удаления; проверить их в приватном окне без входа.
- Заполнить Data safety, content rating, приложение для доступа ревьюера и данные разработчика.
- Загрузить AAB в Internal testing. До production-релиза проверить, применимо ли требование закрытого теста 12 тестировщиков / 14 непрерывных дней для аккаунта.

## Никогда не делать

- Не помещать signing keystore, пароль, service-role key, VAPID private key или cron secret в репозиторий, клиентский код или опубликованные документы.
- Не публиковать ложный `assetlinks.json` с придуманным SHA-256.
- Не утверждать, что Google Play релиз или Push-доставка активны, пока тесты не выполнены на реальном устройстве и в реальном backend.
