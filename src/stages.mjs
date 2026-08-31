// Стадии идут по возрастанию строгости. Порядок важен: стадия вычисляется как
// самая высокая, чьи условия выполнены, и никогда не понижается сама по себе —
// проект, доросший до прода, не становится наброском оттого, что удалили файлы.
export const STAGE_ORDER = ['sketch', 'shaping', 'product', 'sustained'];

// Пороги намеренно грубые. Их задача — заметить, что проект перерос стадию,
// а не измерить его точно: между 14 и 15 файлами нет разницы, а между 15 и 60 есть.
export const THRESHOLDS = {
  shaping: { sourceFiles: 15, directDeps: 8, commits: 30 },
  product: { sourceFiles: 60, loc: 5000 },
  sustained: { contributors: 2, ageDays: 180 },
};

function reachesShaping(m) {
  const reasons = [];
  if (m.sourceFiles >= THRESHOLDS.shaping.sourceFiles) {
    reasons.push(`файлов исходников: ${m.sourceFiles} (порог ${THRESHOLDS.shaping.sourceFiles})`);
  }
  if (m.directDeps >= THRESHOLDS.shaping.directDeps) {
    reasons.push(`прямых зависимостей: ${m.directDeps} (порог ${THRESHOLDS.shaping.directDeps})`);
  }
  if (m.commits >= THRESHOLDS.shaping.commits) {
    reasons.push(`коммитов: ${m.commits} (порог ${THRESHOLDS.shaping.commits})`);
  }
  return reasons;
}

function reachesProduct(m) {
  const reasons = [];
  // Настроенный прод — сигнал сильнее любого счётчика: у проекта появились
  // пользователи, которым сломанная выкатка портит день.
  if (m.hasProductionEnv) reasons.push('в конфиге настроено окружение production');
  if (m.sourceFiles >= THRESHOLDS.product.sourceFiles) {
    reasons.push(`файлов исходников: ${m.sourceFiles} (порог ${THRESHOLDS.product.sourceFiles})`);
  }
  if (m.loc >= THRESHOLDS.product.loc) {
    reasons.push(`строк кода: ${m.loc} (порог ${THRESHOLDS.product.loc})`);
  }
  return reasons;
}

function reachesSustained(m) {
  const reasons = [];
  if (m.contributors >= THRESHOLDS.sustained.contributors) {
    reasons.push(`участников: ${m.contributors} (порог ${THRESHOLDS.sustained.contributors})`);
  }
  if (m.ageDays >= THRESHOLDS.sustained.ageDays) {
    reasons.push(`возраст проекта: ${m.ageDays} дней (порог ${THRESHOLDS.sustained.ageDays})`);
  }
  return reasons;
}

// Сигналы боли весомее счётчиков: они говорят не «проект стал больше»,
// а «текущих проверок уже не хватило». Каждый такой сигнал поднимает стадию
// на одну ступень независимо от размера проекта.
export function applyPainSignals(stage, painSignals) {
  if (!painSignals?.length) return { stage, reasons: [] };
  const index = STAGE_ORDER.indexOf(stage);
  const raised = STAGE_ORDER[Math.min(index + 1, STAGE_ORDER.length - 1)];
  return {
    stage: raised,
    reasons: painSignals.map((s) => `сигнал боли: ${s}`),
  };
}

export function suggestStage(metrics) {
  let stage = 'sketch';
  const reasons = [];

  const shaping = reachesShaping(metrics);
  if (shaping.length > 0) {
    stage = 'shaping';
    reasons.push(...shaping);
  }
  const product = reachesProduct(metrics);
  if (product.length > 0) {
    stage = 'product';
    reasons.push(...product);
  }
  const sustained = reachesSustained(metrics);
  if (sustained.length > 0) {
    stage = 'sustained';
    reasons.push(...sustained);
  }

  const pain = applyPainSignals(stage, metrics.painSignals);
  if (pain.reasons.length > 0) {
    stage = pain.stage;
    reasons.push(...pain.reasons);
  }

  return { stage, reasons };
}

export function isHigher(candidate, current) {
  return STAGE_ORDER.indexOf(candidate) > STAGE_ORDER.indexOf(current);
}
