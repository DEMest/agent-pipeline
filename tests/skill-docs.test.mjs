import test from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './read-text.mjs';

// Достаёт содержимое frontmatter-блока в самом начале файла (между первой парой строк
// «---»). Проверка description именно внутри этого блока, а не где угодно в тексте, —
// иначе строка `description: ...` в теле документа (например, в примере команды) тоже
// засчиталась бы как валидный frontmatter.
function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'файл должен начинаться с frontmatter-блока (--- ... ---)');
  return match[1];
}

const SKILL = () => readText('skills/pipeline-init/SKILL.md');

test('у скилла есть frontmatter с name и description', () => {
  const text = SKILL();
  assert.match(text, /^---\n/);
  const fm = frontmatter(text);
  assert.match(fm, /^name: pipeline-init$/m);
  assert.match(fm, /^description: .+$/m);
});

test('скилл требует три проверки окружения из спецификации', () => {
  const text = SKILL();
  assert.match(text, /gh auth status/);
  assert.match(text, /author\.login/);
  assert.match(text, /gh api repos\/<owner>\/<repo>\/actions\/permissions --jq '\.enabled'/);
});

test('скилл требует снимать команды с проекта, а не выдумывать', () => {
  assert.match(SKILL(), /package\.json/);
});

test('скилл ставит зависимость плагина перед вызовом генератора, а не полагается на её наличие', () => {
  const text = SKILL();
  assert.match(text, /npm install --omit=dev --prefix "\$\{CLAUDE_PLUGIN_ROOT\}"/);
  // объяснение обязательно: почему установка вообще нужна и почему разово
  assert.match(text, /клонирова/i);
  assert.match(text, /node_modules/);
});

test('скилл использует переменную CLAUDE_PLUGIN_ROOT вместо плейсхолдера <plugin>', () => {
  const text = SKILL();
  assert.equal(text.includes('<plugin>'), false, 'плейсхолдер <plugin> не должен оставаться в тексте скилла');
  assert.match(text, /\$\{CLAUDE_PLUGIN_ROOT\}\/src\/cli\.mjs/);
});

test('скилл не затирает существующий .claude/settings.json проекта, а дописывает его', () => {
  const text = SKILL();
  // Основной сценарий из README — существующий проект, где .claude/settings.json может
  // быть со своими хуками и правами. Слепое копирование шаблона поверх него их бы стёрло.
  assert.match(text, /если.{0,40}(файл|settings\.json).{0,60}(нет|отсутствует)/is);
  assert.match(text, /(если|когда).{0,60}(файл|settings\.json).{0,60}(есть|существует|уже)/is);
  assert.match(text, /SessionStart/);
  assert.match(text, /показать человеку/i);
});

test('скилл завершается зелёным CI, а не записью файлов', () => {
  const text = SKILL();
  assert.match(text, /gh pr checks/);
});

test('команда ссылается на скилл', () => {
  assert.match(readText('commands/init.md'), /pipeline-init/);
});

const DOCTOR = () => readText('skills/pipeline-ci-doctor/SKILL.md');

test('у скилла ci-doctor есть frontmatter с именем и описанием', () => {
  const text = DOCTOR();
  assert.match(text, /^---\n/);
  const fm = frontmatter(text);
  assert.match(fm, /^name: pipeline-ci-doctor$/m);
  assert.match(fm, /^description: .+$/m);
});

test('ci-doctor получает диагноз командой diagnose, а не читает сырой лог глазами', () => {
  assert.match(DOCTOR(), /cli\.mjs diagnose/);
});

test('ci-doctor ограничивает число попыток тремя', () => {
  const text = DOCTOR();
  assert.match(text, /три попытки|3 попытки/i);
  assert.match(text, /gh pr comment/, 'счётчик попыток должен фиксироваться комментарием к PR');
});

test('ci-doctor проверяет счётчик попыток раньше, чем получает диагноз', () => {
  const text = DOCTOR();
  // Дефект из ревью: указание прочитать прошлые попытки стояло в шаге 4 — после того как
  // агент уже успевал продиагностировать и запушить исправление. Проверка счётчика должна
  // стоять раньше по тексту, чем команда получения диагноза, иначе документ не остановит
  // четвёртую попытку вовремя.
  const counterCheckIndex = text.search(/Выгрузить тела всех комментариев к PR/);
  const diagnoseIndex = text.search(/cli\.mjs diagnose/);
  assert.notEqual(counterCheckIndex, -1, 'в скилле должно быть указание читать комментарии к PR для подсчёта попыток');
  assert.notEqual(diagnoseIndex, -1, 'в скилле должна быть команда получения диагноза');
  assert.ok(
    counterCheckIndex < diagnoseIndex,
    'проверка счётчика попыток должна стоять в тексте раньше получения диагноза'
  );
});

test('ci-doctor различает поломку кода и поломку самого пайплайна', () => {
  assert.match(DOCTOR(), /drift-check/);
});

test('команда fix-ci ссылается на скилл ci-doctor', () => {
  assert.match(readText('commands/fix-ci.md'), /pipeline-ci-doctor/);
});

const SHIP = () => readText('skills/pipeline-ship/SKILL.md');

test('у скилла ship есть frontmatter с именем и описанием', () => {
  const text = SHIP();
  assert.match(text, /^---\n/);
  const fm = frontmatter(text);
  assert.match(fm, /^name: pipeline-ship$/m);
  assert.match(fm, /^description: .+$/m);
});

test('ship прогоняет локальные проверки раньше, чем пушит ветку', () => {
  const text = SHIP();
  // Прежняя проверка искала подстроку `pipeline.sh` где угодно в файле — упоминание команды
  // после пуша тоже прошло бы, а требование именно в порядке действий: локальный прогон
  // обязан стоять раньше пуша, иначе в CI улетает непроверенный код. Форма — как в тесте
  // порядка для ci-doctor (счётчик попыток раньше диагноза): сравниваем позиции в тексте.
  const localCheckIndex = text.search(/sh scripts\/pipeline\.sh all/);
  const pushIndex = text.search(/git push -u origin/);
  assert.notEqual(localCheckIndex, -1, 'в скилле должна быть команда локального прогона pipeline.sh');
  assert.notEqual(pushIndex, -1, 'в скилле должна быть команда пуша ветки');
  assert.ok(
    localCheckIndex < pushIndex,
    'локальный прогон проверок должен стоять в тексте раньше пуша ветки'
  );
});

test('ship фиксирует изменения коммитом между локальным прогоном проверок и пушем', () => {
  const text = SHIP();
  // Дефект: между шагом локального прогона проверок и шагом пуша не было ни `git add`, ни
  // `git commit` — агент, идущий по скиллу буквально, попытался бы запушить ветку без единого
  // коммита. Форма — как в соседнем тесте порядка (локальный прогон раньше пуша): сравниваем
  // позиции подстрок в тексте.
  const localCheckIndex = text.search(/sh scripts\/pipeline\.sh all/);
  const commitIndex = text.search(/git commit/);
  const pushIndex = text.search(/git push -u origin/);
  assert.notEqual(localCheckIndex, -1, 'в скилле должна быть команда локального прогона pipeline.sh');
  assert.notEqual(commitIndex, -1, 'в скилле должна быть команда фиксации изменений (git commit)');
  assert.notEqual(pushIndex, -1, 'в скилле должна быть команда пуша ветки');
  assert.ok(
    localCheckIndex < commitIndex,
    'фиксация изменений должна стоять в тексте после локального прогона проверок'
  );
  assert.ok(
    commitIndex < pushIndex,
    'фиксация изменений должна стоять в тексте раньше пуша ветки'
  );
});

test('ship разбирает все три режима автономности и описывает исход каждого', () => {
  const text = SHIP();
  // Прежняя проверка искала только имя режима в обратных кавычках — документ, где `full`,
  // `merge-gate` и `prod-gate` просто перечислены списком без пояснений, чем каждый
  // заканчивается, тоже прошёл бы. Пиним фактическую форму пункта списка
  // «- `режим` — <описание>» и требуем содержательный текст после имени, а не только само имя.
  for (const mode of ['full', 'merge-gate', 'prod-gate']) {
    const re = new RegExp('^- `' + mode + '` — (.+)$', 'm');
    const match = text.match(re);
    assert.ok(match, `режим ${mode} должен быть описан пунктом списка вида "- \`${mode}\` — ..."`);
    const outcome = match[1].trim().replace(/[;.\s]/g, '');
    assert.ok(
      outcome.length >= 15,
      `для режима ${mode} в пункте списка должен быть описан исход, а не только имя режима`
    );
  }
});

test('ship честно говорит про prod-gate, что деплой ещё не реализован', () => {
  const text = SHIP();
  // Прежняя проверка искала фразу «деплой не реализован» где угодно в файле — дисклеймер,
  // оторванный от описания prod-gate (например, вынесенный в другой раздел), тоже прошёл бы.
  // Ограничиваем поиск фрагментом от первого упоминания prod-gate до следующего заголовка —
  // именно там человек, читающий про этот режим, должен наткнуться на предупреждение.
  const startIndex = text.indexOf('`prod-gate`');
  assert.notEqual(startIndex, -1, 'в скилле должно быть упоминание режима prod-gate');
  const nextHeading = text.indexOf('\n## ', startIndex);
  const section = nextHeading === -1 ? text.slice(startIndex) : text.slice(startIndex, nextHeading);
  assert.match(
    section,
    /деплой (пока )?не (реализован|настроен)/i,
    'рядом с описанием prod-gate должно быть прямое указание, что деплой не реализован'
  );
});

test('ship передаёт красный CI скиллу ci-doctor, а не чинит сам', () => {
  assert.match(SHIP(), /pipeline-ci-doctor/);
});

test('ship не мерджит, пока проверки не зелёные', () => {
  assert.match(SHIP(), /gh pr checks/);
});

test('команда ship ссылается на скилл', () => {
  assert.match(readText('commands/ship.md'), /pipeline-ship/);
});

test('init кладёт compose в проект, когда в конфиге есть выкатка', () => {
  // Без этого файла workflow выкатки падает на копировании его на сервер.
  const text = readText('skills/pipeline-init/SKILL.md');
  assert.match(text, /deploy\/compose\.yml/);
  assert.match(text, /SSH_KEY/);
  assert.match(text, /Environment/);
});

test('init определяет систему сборки java по файлам, а не угадывает', () => {
  // От build зависят команды, кэш в CI и место артефакта — угадать её позже нельзя.
  const text = readText('skills/pipeline-init/SKILL.md');
  assert.match(text, /project\.build/);
  assert.match(text, /build\.gradle/);
  assert.match(text, /preset-maven\.json/);
  assert.match(text, /preset-gradle\.json/);
});

test('init берёт версию JDK из проекта, а не из головы', () => {
  const text = readText('skills/pipeline-init/SKILL.md');
  assert.match(text, /project\.java_version/);
  assert.match(text, /java\.version|maven\.compiler\.release/);
});

test('init создаёт файл блокировки для нового проекта — без него npm ci в CI падает', () => {
  // Проверено фактически: npm ci в пустом проекте без package-lock.json завершается ошибкой,
  // то есть новый проект получил бы красный CI на первом же прогоне.
  const text = readText('skills/pipeline-init/SKILL.md');
  assert.match(text, /npm install/);
  assert.match(text, /package-lock\.json/);
  assert.match(text, /npm ci/);
});

test('init спрашивает стек, когда папка пуста, а не угадывает его', () => {
  const text = readText('skills/pipeline-init/SKILL.md');
  const emptySection = text.indexOf('Если в папке пусто');
  assert.notEqual(emptySection, -1, 'в скилле должен быть раздел про пустую папку');
  const nextHeading = text.indexOf('\n## ', emptySection);
  const section = nextHeading === -1 ? text.slice(emptySection) : text.slice(emptySection, nextHeading);
  assert.match(section, /git init/);
  assert.match(section, /sketch/);
});

test('init определяет менеджер зависимостей python по файлам', () => {
  const text = readText('skills/pipeline-init/SKILL.md');
  assert.match(text, /poetry\.lock/);
  assert.match(text, /uv\.lock/);
  assert.match(text, /preset-pip\.json/);
});

test('init знает, что у go нет поля build', () => {
  // Валидатор отвергает build у go, и скилл должен объяснять почему,
  // иначе агент будет пытаться его заполнить и получать ошибку.
  const text = readText('skills/pipeline-init/SKILL.md');
  const goSection = text.slice(text.indexOf('### Если стек go'));
  assert.match(goSection, /project\.build/);
  assert.match(goSection, /go\.mod/);
});

const AGENTS = () => readText('AGENTS.md');

test('AGENTS.md даёт способ вызова инструмента без Claude Code', () => {
  // Без этого агент вне Claude не найдёт генератор: переменной CLAUDE_PLUGIN_ROOT
  // у него нет, а путь до клона репозитория ниоткуда не следует.
  const text = AGENTS();
  assert.match(text, /npx --yes github:DEMest\/agent-pipeline/);
  assert.match(text, /node \/путь\/к\/клону/);
});

test('AGENTS.md описывает все три процедуры', () => {
  const text = AGENTS();
  for (const procedure of ['Развернуть пайплайн', 'Провести задачу', 'Починить красный CI']) {
    assert.ok(text.includes(procedure), `в AGENTS.md нет процедуры «${procedure}»`);
  }
});

test('AGENTS.md называет те же команды инструмента, что понимает CLI', () => {
  // Страж рассинхрона: команду добавили в CLI и забыли в инструкции для агентов
  // (или наоборот, описали несуществующую) — тест краснеет здесь.
  const cli = readText('src/cli.mjs');
  const usage = cli.match(/<(generate\|[a-z|]+)>/);
  assert.ok(usage, 'в cli.mjs не найдена строка использования с перечнем команд');
  const commands = usage[1].split('|');
  const agents = AGENTS();
  for (const command of commands) {
    assert.ok(agents.includes(`$PIPELINE ${command}`), `AGENTS.md не описывает команду ${command}`);
  }
});

test('лимит попыток в AGENTS.md совпадает со скиллом починки CI', () => {
  // Две инструкции об одном и том же процессе не должны расходиться в числах.
  const agents = AGENTS();
  const skill = readText('skills/pipeline-ci-doctor/SKILL.md');
  assert.match(agents, /Лимит — три на один pull request/);
  assert.match(skill, /три попытки|Лимит — три/i);
});
