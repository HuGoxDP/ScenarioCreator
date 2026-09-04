# Завдання: перезбірка сценаріїв і перепублікація у Virtual Lab

Статус: **збірка завершена, лишилася публікація** · Замовник: `virtual-lab` (платформа) ·
Створено 2026-08-01 · Оновлено 2026-08-02

---

## Навіщо

Платформа `virtual-lab` роздає **застарілі** архіви. Вони потрапили туди імпортом з Google
Drive і не збігаються з тим, що зараз збирає цей репозиторій. Два наслідки:

1. **`Benchscene1_primitives` досі містить `scripts/helpers/BenchmarkHarness.js`** — вшитий
   бенчмарк, від якого репозиторій відмовився у комміті `05af25d`
   (*refactor: strip embedded benchmarking; scenarios are content-only*). Вимірювати
   продуктивність цим архівом не можна: числа опишуть старий вшитий харнес, а не рушій.
2. Решта трьох архівів у платформі теж старі — розміри не збігаються з поточними
   `ReleaseScenarios/`.

Перевірено 2026-08-01:

| Каталожний id у `virtual-lab` | Байт у платформі | Файл тут | Байт тут | Харнес усередині |
|---|---|---|---|---|
| `solar-system` | 18 526 012 | `solar-system-scenario.zip` | 18 256 979 | немає |
| `Benchscene1_primitives` | 5 771 | `Benchscene1_primitives.zip` | 5 771 | **`scripts/helpers/BenchmarkHarness.js`** |
| `Benchscene2 complexmodel` | 29 355 486 | `Benchscene2_complexmodel.zip` | 29 352 066 | немає |
| `Benchscene3 solarsystem` | 6 601 316 | `Benchscene3_solarsystem.zip` | 9 824 298 | немає |

---

## Блокер — ✅ вирішено (варіант 1)

Вихідники знайшлися в git: їх видалив саме коміт `05af25d`. Відновлено з `05af25d^` у
`Scenarios/Benchscene1_primitives/scripts/Scenario.ts` і приведено до content-only вигляду —
рівно тим самим прибиранням, що застосували тоді до Benchscene2/3:

- прибрано `BenchmarkHarness` (імпорт, поле, `tick()`/`report()`) і теку `helpers/`;
- прибрано CONFIG-тумблери `OBJECT_COUNT` / `ANIMATE_PERCENT` / `SHADER_WARMUP` /
  `DIRTY_TRANSFORMS` / `SHOW_OVERLAY` / `WARMUP` / `SAMPLES`;
- прибрано `Transform._setDirtyTransformsEnabled`, `Application.warmupShaders`,
  `MemoryProfiler` — це важелі рушійного харнеса, а не вміст сцени.

Лишився детермінований вміст: камера, світло, сітка з 1000 примітивів (5 спільних мешів,
5 спільних матеріалів), підлога, рівномірне обертання від `Time.time`.

Архів перезібрано: **2 295 байт, 3 записи, без жодного файлу `Benchmark*`** (було 5 771 байт,
6 записів із `scripts/helpers/BenchmarkHarness.js`).

---

## Що зробити

### 1. Перезібрати всі сценарії — ✅ зроблено 2026-08-02

```powershell
cd C:\Users\HuGox\WebstormProjects\ScenarioCreator
npm run clean:release
npm run build:all
```

Для `Benchscene3_solarsystem` з подвійним форматом текстур (потрібен KTX-Software на PATH):

```powershell
$env:INCLUDE_SKYBOX = "1"
$env:FORCE = "1"          # інакше наявні .ktx2 не перекодовуються
npm run build -- --scenario Benchscene3_solarsystem --ktx2
```

> Попередження «PowerShell, не Git Bash» більше не актуальне: `build-package.mjs` тепер
> резолвить `tar.exe` явно у `System32` (bsdtar), а не бере перший-ліпший з PATH. Збірка
> проходить з будь-якої оболонки.

### 2. Перевірити результат перед публікацією — ✅ зроблено 2026-08-02

Для кожного ZIP у `ReleaseScenarios/` перевірено, що:

- [x] у `namelist()` **немає** жодного файлу зі словом `Benchmark`;
- [x] `manifest.json` лежить **у корені** архіву (не в підтеці);
- [x] `manifest.json` парситься і має всі обов'язкові поля: `manifestVersion`, `id`, `name`,
      `version`, `entryPoint`;
- [x] файл `scripts/<entryPoint>` справді присутній в архіві.

Перевірку виконано не переказом правил, а прогоном архівів через **сам валідатор платформи**
(`virtual-lab/backend/archive-validation.js`, викликаний напряму) — усі 4 повернули `PASS`.
Єдині зауваження — очікуване попередження про розбіжність manifest-id і каталожного id
(див. розділ про template-метадані нижче).

Результат збірки — **оновлено 2026-08-12**, після P0–P4 у [`../../.claude-shared/PLAN.md`](../../.claude-shared/PLAN.md):

| Файл | Байт зараз | Байт у платформі (старі) | Записів | Manifest id | Версія |
|---|---|---|---|---|---|
| `Benchscene1_primitives.zip` | 2 231 | 5 771 | 3 | `benchscene1-primitives` | 1.0.0 |
| `Benchscene2_complexmodel.zip` | **9 710 408** | 29 355 486 | 6 | `benchscene2-complexmodel` | 1.0.0 |
| `Benchscene3_solarsystem.zip` | 10 435 597 | 6 601 316 | 36 | `benchscene3-solarsystem` | 1.0.0 |
| `solar-system-scenario.zip` | 18 257 726 | 18 526 012 | 31 | **`solar-system`** | 3.5.0 |
| `Molecules.zip` | 22 483 | — (нового немає в каталозі) | 13 | `molecules` | 1.0.0 |

Три зміни проти запису від 2026-08-02:

- **`Benchscene2_complexmodel` схуд із 29.4 МБ до 9.7 МБ** — модель стиснено (P0). Це найбільша
  зміна в каталозі, і саме її мав відчути студент.
- **Жоден архів більше не доповідає `template.*`** (P2). `solar-system-scenario` тепер оголошує
  `id: solar-system`, тобто збігається з каталожним — попередження про розбіжність зникло.
- `Benchscene3_solarsystem` усе ще везе **обидва** формати: 12 оригіналів + 12 `.ktx2`.
  Прибрати це можна лише після того, як платформа читатиме маніфести — див. P3 у `../../.claude-shared/PLAN.md`.

`Molecules` у таблиці 2026-08-02 не було; чи заводити його в каталозі — окреме рішення.

### 2a. Що з'явилося поруч і **не** йде в `/admin`

Збірка тепер може випускати ще один артефакт — стрімінговий маніфест:

```powershell
npm run manifest:all -- --tests     # ReleaseScenarios\*.scenario.json + objects\
npm run manifest:verify             # файли на місці, хеші збігаються
npm run manifest:verify-fetch       # рушій їх тягне по HTTP
npm run manifest:verify-render      # обидва шляхи рендерять те саме
```

**Через `/admin` завантажуються тільки `.zip`.** Платформа поки не вміє читати маніфести, тож
`*.scenario.json` і теку `objects/` вона просто не прийме. Вони існують, щоб цей шлях можна
було міряти — і роздаються будь-яким статичним сервером без жодного платформного коду.
Подробиці й порядок — P1/P3 у [`../../.claude-shared/PLAN.md`](../../.claude-shared/PLAN.md).

### 3. Опублікувати у платформі

Через `/admin` (див. `virtual-lab/Readme.md`, розділ «Публікація сценарію»):

1. Відкрити <http://localhost:8044/admin>, ввести `ADMIN_TOKEN` з `virtual-lab/.env`.
2. Для кожного сценарію натиснути **Архів…** і вибрати відповідний ZIP.
3. Переконатися, що у відповіді новий `sha256` — якщо повідомлення каже
   «дедуплікація», значить завантажився **той самий** старий файл.

Відповідність імен (вони **не** збігаються — це нормально):

| Файл тут | Каталожний id у платформі |
|---|---|
| `solar-system-scenario.zip` | `solar-system` |
| `Benchscene2_complexmodel.zip` | `Benchscene2 complexmodel` |
| `Benchscene3_solarsystem.zip` | `Benchscene3 solarsystem` |
| `Benchscene1_primitives.zip` | `Benchscene1_primitives` |

Усі чотири рядки вже існують у каталозі (перевірено `GET /api/catalog` на живому
інстансі 2026-08-02), створювати нові не треба — лише перезавантажити архіви.

### 4. Прибрати за собою

- [x] Закомітити зміни збірки: `build-package.mjs` (резолв `bash` і `tar`), `.gitignore`
      і відновлений `Scenarios/Benchscene1_primitives/`.
- [x] `.ktx2`-текстури **не** комітяться — додано `*.ktx2` у `.gitignore`. Вони регенеруються
      з трекнутих `.jpg`, тож у git їм не місце (як і `ReleaseScenarios/`).
- [ ] Оновити тарбол рушія тут, якщо потрібна свіжа збірка: `WebEngineTS-0.1.0.tgz` у цьому
      репозиторії окремий від того, що у `virtual-lab`, і теж показується зміненим.
      **Наразі не закомічено** — це окремий бамп рушія, не частина цієї перезбірки.
      `package-lock.json` показує `0.1.0-local.1784628468712` → `0.1.0-local.1785584399455`.

---

## Окреме питання: template-метадані в маніфесті — ✅ вирішено 2026-08-12

Нижче — опис проблеми, як вона стояла. **Її полагоджено** в цьому репозиторії (P2 у
[`../../.claude-shared/PLAN.md`](../../.claude-shared/PLAN.md)): метадані беруться з необов'язкового `<scenario>/scenario.meta.json`, а
запасний варіант **виводиться** з імені теки замість заглушки. `engineVersion` штампується з
установленого рушія. Перевірено: жоден із п'яти архівів не доповідає `template.*`, і всі п'ять
проходять `archive-validation.js` **без жодного попередження**.

Текст нижче лишено як опис того, чому це робилося.

### Як це виглядало раніше

`build-package.mjs:240-256` жорстко зашиває **заглушки** у кожен маніфест:

```js
id: `template.${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}`,
name: `Template ${scenarioName}`,
version: "0.0.1-template",
description: "Template description: replace with scenario details.",
category: "template",
author: { name: "Template Author", email: "template.author@example.com" },
engineVersion: "0.0.0-template",
```

Тому кожен опублікований сценарій має `id` виду `template.benchscene3.solarsystem` і версію
`0.0.1-template`. Платформа це переживає — вона свідомо не звіряє каталожний id з маніфестним
і показує розбіжність попередженням, а не помилкою. Але:

- у каталозі та в адмінці видно `0.0.1-template` замість справжньої версії;
- `author`/`description` з маніфеста непридатні для показу;
- два різні сценарії ніколи не конфліктують лише тому, що id похідний від імені теки.

**Як це зроблено:** метадані читаються з `<scenario>/scenario.meta.json` (не `scenario.json` —
щоб не плутати з маніфестом, який емітить `build-manifest.mjs`). Поля, яких ніхто не заявив,
**пропускаються**, а не заповнюються вигадкою: хибний автор у каталозі гірший за відсутнього.
Спільний модуль `scenario-meta.mjs` обслуговує обидва збирачі, бо `id` і guid ассетів мусять
збігатися між ZIP і маніфестом.

---

## Критерій готовності

- [x] Жоден ZIP у `ReleaseScenarios/` не містить файлів бенчмарк-харнеса.
- [x] Усі архіви проходять валідацію платформи — перевірено прогоном через
      `archive-validation.js` локально. *(Підтвердження кодом 201 буде на завантаженні.)*
- [ ] У `virtual-lab` кожен сценарій має **новий** `archive_sha256` (не «дедуплікація»).
- [ ] Кожен сценарій відкривається і рендериться на <http://localhost:8044/catalog>.
- [x] Питання `Benchscene1_primitives` закрите — варіант 1 (відновлення вихідників).
- [x] Жоден архів не доповідає `template.*`; валідатор платформи повертає **нуль попереджень**
      на всіх п'ятьох (перевірено 2026-08-12).
- [x] Кожен сценарій рендериться — обома шляхами, у справжньому браузері
      (`npm run manifest:verify-render`). Це не замінює перевірку на `/catalog`, бо там інший
      хост і справжній GPU, але «архів взагалі не відкривається» вже виключено.

Два незакриті пункти вимагають завантаження через `/admin` — виконується вручну.

**Перезаливати треба заново:** архіви змінилися після 2026-08-02, найпомітніше
`Benchscene2_complexmodel` (29.4 МБ → 9.7 МБ). Ті `sha256`, що вже в платформі, застаріли для
всіх чотирьох.
