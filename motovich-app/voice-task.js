/* MOTOVICH voice task parser — deterministic, testable Russian date/time parsing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MOTOVICHVoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MONTHS = {
    'января':0,'январе':0,'январь':0,'февраля':1,'феврале':1,'февраль':1,
    'марта':2,'марте':2,'март':2,'апреля':3,'апреле':3,'апрель':3,'мая':4,'мае':4,'май':4,
    'июня':5,'июне':5,'июнь':5,'июля':6,'июле':6,'июль':6,'августа':7,'августе':7,'август':7,
    'сентября':8,'сентябре':8,'сентябрь':8,'октября':9,'октябре':9,'октябрь':9,
    'ноября':10,'ноябре':10,'ноябрь':10,'декабря':11,'декабре':11,'декабрь':11
  };
  const WEEKDAYS = {'понедельник':1,'вторник':2,'среду':3,'среда':3,'четверг':4,'пятницу':5,'пятница':5,'субботу':6,'суббота':6,'воскресенье':0};
  const TASK_VERBS = 'позвонить|перезвонить|созвониться|купить|отправить|написать|проверить|забрать|оплатить|заказать|подготовить|сделать|сходить|встретиться|доделать|закончить|организовать|записаться|помыть|отвезти|заехать|выполнить|поздравить|принять|сдать|поставить|разобрать|заплатить|загрузить|обновить|создать|запустить|передать|согласовать|обсудить|узнать|найти|забронировать|вернуть|открыть|закрыть|внести|подписать|опубликовать|смонтировать|заехать|найти|позаниматься';
  const LETTER = 'А-Яа-яЁё';

  function localDateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function baseNoon(now) {
    const d = now instanceof Date ? new Date(now.getTime()) : new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }
  function validDate(year, month, day) {
    const d = new Date(year, month, day, 12, 0, 0, 0);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? localDateKey(d) : '';
  }
  function advanceDate(now, days) {
    const d = baseNoon(now);
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }
  function removeMatched(text, match) {
    return text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
  }
  function parseOne(raw, now) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^[,;:\s]+|[,;:\s]+$/g, '');
    if (!text) return {name:'',date:'',time:'',priority:'Средний'};
    const base = baseNoon(now);
    let date = '', time = '', match;

    // Numeric date: 21.10, 21/10/2026, 21-10-26; impossible dates stay as text.
    match = text.match(/(^|[^0-9])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?=$|[^0-9])/);
    if (match) {
      let year = match[4] ? Number(match[4]) : base.getFullYear();
      if (year < 100) year += 2000;
      date = validDate(year, Number(match[3]) - 1, Number(match[2]));
      if (date) text = removeMatched(text, match);
    }

    // Russian month names, e.g. "5 ноября" or "5 ноября 2027".
    if (!date) {
      match = text.toLocaleLowerCase('ru-RU').match(/(^|[^0-9])(\d{1,2})\s+(января|январе|январь|февраля|феврале|февраль|марта|марте|март|апреля|апреле|апрель|мая|мае|май|июня|июне|июнь|июля|июле|июль|августа|августе|август|сентября|сентябре|сентябрь|октября|октябре|октябрь|ноября|ноябре|ноябрь|декабря|декабре|декабрь)(?:\s+(\d{4}))?(?=$|[^А-Яа-яЁё])/i);
      if (match) {
        const year = match[4] ? Number(match[4]) : base.getFullYear();
        date = validDate(year, MONTHS[match[3]], Number(match[2]));
        if (date) text = removeMatched(text, match);
      }
    }

    // Relative dates. Avoid JavaScript \b: it does not treat Cyrillic as word characters.
    if (!date) {
      const lower = text.toLocaleLowerCase('ru-RU');
      match = lower.match(new RegExp('(^|[^' + LETTER + '])(сегодня|завтра|послезавтра)(?=$|[^' + LETTER + '])', 'i'));
      if (match) {
        date = advanceDate(base, match[2] === 'завтра' ? 1 : match[2] === 'послезавтра' ? 2 : 0);
        text = removeMatched(text, match);
      }
    }
    if (!date) {
      const lower = text.toLocaleLowerCase('ru-RU');
      match = lower.match(new RegExp('(^|[^' + LETTER + '])через\\s+(один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|\\d{1,3})\\s+(день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев)(?=$|[^' + LETTER + '])', 'i'));
      if (!match) match = lower.match(new RegExp('(^|[^' + LETTER + '])через\\s+неделю(?=$|[^' + LETTER + '])', 'i'));
      if (match) {
        if (match[2]) {
          const amount = ({один:1,одну:1,два:2,две:2,три:3,четыре:4,пять:5,шесть:6,семь:7,восемь:8,девять:9,десять:10})[match[2]] || Number(match[2]) || 1;
          const unit = match[3];
          const days = /недел/.test(unit) ? amount * 7 : /месяц/.test(unit) ? amount * 30 : amount;
          date = advanceDate(base, Math.min(days, 365));
        } else date = advanceDate(base, 7);
        text = removeMatched(text, match);
      }
    }
    if (!date) {
      const lower = text.toLocaleLowerCase('ru-RU');
      match = lower.match(new RegExp('(^|[^' + LETTER + '])(?:(?:в|во)\\s+)?(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)(\\s+следующей\\s+недели|\\s+на\\s+следующей\\s+неделе)?(?=$|[^' + LETTER + '])', 'i'));
      if (match) {
        const explicitlyNext = Boolean(match[3]);
        const dayName = match[2];
        let delta = (WEEKDAYS[dayName] - base.getDay() + 7) % 7;
        if (delta === 0 && explicitlyNext) delta = 7;
        else if (explicitlyNext) delta += 7;
        date = advanceDate(base, delta);
        text = removeMatched(text, match);
      }
    }

    // Exact clock time and spoken hour/minute phrases.
    match = text.match(/(^|[^А-Яа-яЁё])(?:в|к)\s*(\d{1,2})[:.](\d{2})(?=$|[^0-9])/i);
    if (match) {
      const hour = Number(match[2]), minute = Number(match[3]);
      if (hour <= 23 && minute <= 59) {
        time = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        text = removeMatched(text, match);
      }
    }
    if (!time) {
      match = text.match(new RegExp('(^|[^' + LETTER + '])(?:в|к)\\s*(\\d{1,2})(?:\\s*(утра|дня|вечера|ночи))?(?:\\s*час(?:а|ов)?)?(?:\\s*(\\d{1,2})\\s*минут(?:а|ы)?)?', 'i'));
      if (match) {
        let hour = Number(match[2]), minute = Number(match[4] || 0);
        const period = String(match[3] || '').toLowerCase();
        const valid = hour <= 23 && minute <= 59 && (period ? hour >= 1 && hour <= 12 : true);
        if (valid) {
          if ((period === 'вечера' || period === 'дня') && hour < 12) hour += 12;
          if ((period === 'ночи' || period === 'утра') && hour === 12) hour = 0;
          time = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
          text = removeMatched(text, match);
        }
      }
    }
    const noTimeWord = new RegExp('(^|[^' + LETTER + '])(полдень|полночь)(?=$|[^' + LETTER + '])', 'i');
    if (!time && noTimeWord.test(text)) {
      match = text.match(noTimeWord);
      time = match[2].toLowerCase() === 'полдень' ? '12:00' : '00:00';
      text = removeMatched(text, match);
    }

    let priority = 'Средний';
    const high = new RegExp('(^|[^' + LETTER + '])(срочно|очень важно|высокий приоритет|приоритет высокий)(?=$|[^' + LETTER + '])', 'i');
    const low = new RegExp('(^|[^' + LETTER + '])(не срочно|низкий приоритет|приоритет низкий)(?=$|[^' + LETTER + '])', 'i');
    match = text.match(high);
    if (match) {
      priority = 'Высокий';
      text = removeMatched(text, match);
    } else {
      match = text.match(low);
      if (match) {
        priority = 'Низкий';
        text = removeMatched(text, match);
      }
    }
    text = text
      .replace(new RegExp('(^|[^' + LETTER + '])(?:на\\s+)?(?:сегодня|завтра|послезавтра)(?=$|[^' + LETTER + '])', 'ig'), ' ')
      .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '')
      .replace(/^(?:пожалуйста[, ]*)?(?:задача|напомни мне|напомни|мне нужно|мне надо|надо|нужно|сделать)\s+/i, '')
      .replace(/\s+/g, ' ').trim();
    return {name:text.slice(0,160),date,time,priority};
  }

  function splitTasks(raw) {
    let text = String(raw || '').replace(/\r/g, '\n').trim();
    if (!text) return [];
    text = text.split(/\n+|;+\s*|\s+(?:а\s+ещ[её]|и\s+ещ[её]|потом|затем|следующая\s+задача|следом)\s+/i).join('\n');
    const starters = '(?:' + TASK_VERBS + ')';
    const datePrefix = '(?:(?:сегодня|завтра|послезавтра|(?:в|во)\\s+(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|через\\s+\\w+\\s+дн(?:я|ей))\\s+)?';
    text = text.split(new RegExp('[,]\\s*(?=' + datePrefix + starters + '(?=\\s))', 'ig')).join('\n');
    text = text.split(new RegExp('\\s+и\\s+(?=' + starters + '(?=\\s))', 'ig')).join('\n');
    return text.split(/\n+/).map(part => part.replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g,'').trim()).filter(Boolean).slice(0,20);
  }
  function parseTasks(raw, now) {
    return splitTasks(raw).map(part => parseOne(part, now)).filter(task => task.name);
  }
  return {parseOne,parseTasks,splitTasks,localDateKey};
});
