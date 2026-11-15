-- Счётчики RANDOMLOCK: день (по Москве) × сайт (main/dev) × событие × измерение × значение → сколько раз.
-- Строка с пустыми dim/val — итог события за день.
CREATE TABLE IF NOT EXISTS hits (
  day TEXT NOT NULL,
  env TEXT NOT NULL,
  ev TEXT NOT NULL,
  dim TEXT NOT NULL DEFAULT '',
  val TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, env, ev, dim, val)
);
CREATE INDEX IF NOT EXISTS hits_env_day ON hits (env, day);

-- Отпечатки посетителей за текущие сутки (sha256 с солью дня), только чтобы не считать человека дважды.
-- Старше вчерашнего дня удаляются самим Worker.
CREATE TABLE IF NOT EXISTS visitors (
  day TEXT NOT NULL,
  env TEXT NOT NULL,
  h TEXT NOT NULL,
  PRIMARY KEY (day, env, h)
);
