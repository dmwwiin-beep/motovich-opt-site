/* MOTOVICH voice task parser — pure functions shared by app and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MOTOVICHVoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WEEKDAYS = {
    'понедельник': 1, 'в понедельник': 1,
    'вторник': 2, 'во вторник': 2, 'вторник': 2,
    'среду': 3, 'в среду': 3, 'среда': 3,
    'четверг': 4, 'в четверг': 4,
    'пятницу': 5, 'в пятницу': 5, 'пятница': 5,
    'субботу': 6, 'в субботу': 6, 'суббота': 6,
    'воскресенье': 0, 'в воскресенье': 0
  };
  const MONTHS = {
    'января': 0, 'январе': 0, 'январь': 0,
    'февраля': 1, 'феврале': 1, 'февраль': 1,
    'марта': 2, 'марте': 2, 'март': 2,
    'апреля': 3, 'апреле': 3, 'апрель': 3,
    'мая': 4, 'мае': 4, 'май': 4,
    'июня': 5, 'июне': 5, 'июнь': 5,
    'июля': 6, 'июле': 6, 'июль': 6,
    'августа': 7, 'августе': 7, 'август': 7,
    'сентября': 8, 'сентябре': 8, 'сентябрь': 8,
    'октября': 9, 'октябре': 9, 'октябрь': 9,
    'ноября': 10, 'ноябре': 10, 'ноябрь': 10,
    'декабря': 11, 'декабре': 11, 'декабрь': 11
  };
  const TASK_VERBS = 'позвонить|перезвонить|созвониться|купить|отправить|написать|проверить|забрать|оплатить|заказать|подготовить|сделать|сходить|встретиться|доделать|закончить|организовать|записаться|помыть|отвезти|заехать|выполнить|поздравить|принять|сдать|поставить|разобрать|заплатить|загрузить|обновить|создать|запустить|передать|согласовать|оплатить|обсудить|отправить|узнать|найти|купить|забронировать|заехать|заказать|вернуть|открыть|закрыть|внести|подписать|опубликовать|смонтировать|проверить';

  function localDateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function validDate(year, month, day) {
    const d = new Date(year, month, day, 12, 0, 0, 0);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? localDateKey(d) : '';
  }
  function baseNoon(now) {
    const d = now instanceof Date ? new Date(now.getTime()) : new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }
  function advanceDate(now, days) {
    const d = baseNoon(now);
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }
  function dateForWeekday(now, target, explicitlyNext) {
    const d = baseNoon(now);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0 && explicitlyNext) delta = 7;
    if (explicitlyNext && delta < 7) delta += 7;
    d.setDate(d.getDate() + delta);
    return localDateKey(d);
  }
  function removeMatched(text, match) {
    return text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
  }

  function parseOne(raw, now) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^[,;:\s]+|[,;:\s]+$/g, '');
    if (!text) return { name: '', date: '', time: '', priority: 'Средний' };
    const base = baseNoon(now);
    let date = '';
    let time = '';
    let match;

    // Numeric dates: 21.10, 21/10/2026, or 21-10-26. Reject impossible dates.
    match = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
    if (match) {
      let year = match[3] ? Number(match[3]) : base.getFullYear();
      if (year < 100) year += 2000;
      date = validDate(year, Number(match[2]) - 1, Number(match[1]));
      if (date) text = removeMatched(text, match);
    }

    // Russian month names: "5 ноября", "5 ноября 2027".
    if (!date) {
      match = text.toLocaleLowerCase('ru-RU').match(/\b(\d{1,2})\s+(января|январе|январь|февраля|феврале|февраль|марта|марте|март|апреля|апреле|апрель|мая|мае|май|июня|июне|июнь|июля|июле|июль|августа|августе|август|сентября|сентябре|сентябрь|октября|октябре|октябрь|ноября|ноябре|ноябрь|декабря|декабре|декабрь)(?:\s+(\d{4}))?\b/);
      if (match) {
        const year = match[3] ? Number(match[3]) : base.getFullYear();
        date = validDate(year, MONTHS[match[2]], Number(match[1]));
        if (date) text = removeMatched(text, match);
      }
    }

    if (!date) {
      const lower = text.toLocaleLowerCase('ru-RU');
      match = lower.match(/\b(сегодня|завтра|послезавтра)\b/);
      if (match) {
        date = advanceDate(base, match[1] === 'завтра' ? 1 : match[1] === 'послезавтра' ? 2 : 0);
        text = removeMatched(text, match);
      }
    }
    if (!date) {
      const lower = text.toLocaleLowerCase('ru-RU');
      match = lower.match(/\bчерез\s+(один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|\d{1,3})\s+(день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев)\b/);
      if (match) {
        const amount = ({ 'один': 1, 'одну': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10 })[match[1]] || Number(match[1]) || 1;
        const unit = match[2];
        const days = /недел/.test(unit) ? amount * 7 : /месяц/.test(unit) ? amount * 30 : amount;
        date = advanceDate(base, Math.min(days, 365));
        text = removeMatched(text, match);
      } else {
        match = lower.match(/\bчерез\s+неделю\b/);
        if (match) {
          date = advanceDate(base, 7);
          text = removeMatched(text, match);
        }
      }
    }
    if (!date) {
      const lower = text.toLocaleLowerCase('ru-RU');
      match = lower.match(/\b(?:(?:в|во)\s+)?(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)(?:\s+следующей\s+недели|\s+на\s+следующей\s+неделе)?\b/);
      if (match) {
        const explicitlyNext = /следующ/.test(match[0]);
        const aliases = { 'среда': 'среду', 'пятница': 'пятницу', 'суббота': 'субботу' };
        const normalized = aliases[match[1]] || match[1];
        date = dateForWeekday(base, WEEKDAYS[normalized], explicitlyNext);
        text = removeMatched(text, match);
      }
    }

    // Time in 24-hour notation or colloquial Russian: "в 10", "к 15:30", "в 7 вечера".
    match = text.match(/\b(?:в|к)\s*(\d{1,2})[:.](\d{2})\b/i);
    if (match) {
      const hour = Number(match[1]), minute = Number(match[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        time = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        text = removeMatched(text, match);
      }
    }
    if (!time) {
      match = text.match(/\b(?:в|к)\s*(\d{1,2})(?:\s*(утра|дня|вечера|ночи))?(?:\s*час(?:а|ов)?)?(?:\s*(\d{1,2})\s*минут(?:а|ы)?)?\b/i);
      if (match) {
        let hour = Number(match[1]), minute = Number(match[4] || 0);
        const period = String(match[2] || '').toLowerCase();
        const valid = hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 &&
          (period ? hour >= 1 && hour <= 12 : hour <= 23);
        if (valid) {
          if ((period === 'вечера' || period === 'дня') && hour < 12) hour += 12;
          if (period === 'ночи' && hour === 12) hour = 0;
          if (period === 'утра' && hour === 12) hour = 0;
          time = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
          text = removeMatched(text, match);
        }
      }
    }
    if (!time && /\bполдень\b/i.test(text)) {
      time = '12:00';
      text = text.replace(/\bполдень\b/i, ' ');
    } else if (!time && /\bполночь\b/i.test(text)) {
      time = '00:00';
      text = text.replace(/\bполночь\b/i, ' ');
    }

    let priority = 'Средний';
    if (/\b(срочно|очень важно|высокий приоритет|приоритет высокий)\b/i.test(text)) {
      priority = 'Высокий';
      text = text.replace(/\b(срочно|очень важно|высокий приоритет|приоритет высокий)\b/ig, ' ');
    } else if (/\b(не срочно|низкий приоритет|приоритет низкий)\b/i.test(text)) {
      priority = 'Низкий';
      text = text.replace(/\b(не срочно|низкий приоритет|приоритет низкий)\b/ig, ' ');
    }

    text = text.replace(/\b(на сегодня|на завтра|на послезавтра)\b/ig, ' ')
      .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '')
      .replace(/^(?:пожалуйста[, ]*)?(?:задача|напомни мне|напомни|мне нужно|мне надо|надо|нужно|сделать)\s+/i, '')
      .replace(/\s+/g, ' ').trim();
    return { name: text.slice(0, 160), date, time, priority };
  }

  function splitTasks(raw) {
    let text = String(raw || '').trim();
    if (!text) return [];
    text = text.replace(/\r/g, '\n');
    const starter = '(?:' + TASK_VERBS + ')';
    const segments = text
      .split(/\n+|;+\s*|\b(?:а\s+ещ[её]|и\s+ещ[её]|потом|затем|следующая\s+задача|следом)\b/ig)
      .flatMap(part => part.split(new RegExp(',\\s*(?=(?:(?:сегодня|завтра|послезавтра|(?:в|во)\\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|через\\s+\\w+\\s+дн(?:я|ей))\\s+)?' + starter + '\\b)', 'ig')))
      .flatMap(part => part.split(new RegExp('\\s+и\\s+(?=' + starter + '\\b)', 'ig')))
      .map(part => part.replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '').trim())
      .filter(Boolean);
    return segments.slice(0, 20);
  }

  function parseTasks(raw, now) {
    return splitTasks(raw).map(part => parseOne(part, now)).filter(task => task.name);
  }

  return { parseOne, parseTasks, splitTasks, localDateKey };
});
