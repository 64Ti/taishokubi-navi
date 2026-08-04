/**
 * holidays.js
 * 日本の国民の祝日・振替休日判定モジュール（実用簡易実装／西暦2000〜2035年対応）。
 * 会社の定休日設定（土曜稼働・祝日稼働・独自休業日）に応じた営業日判定にも対応する。
 * window.HolidaysJP として公開。
 */
(function (global) {
  'use strict';

  function toKey(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // 春分・秋分日の近似計算（1980〜2099年で実用精度）
  function vernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  function autumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  // 第n月曜日を求める（ハッピーマンデー制度対応）
  function nthMonday(year, month, n) {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(year, month - 1, day);
      if (dt.getMonth() !== month - 1) break;
      if (dt.getDay() === 1) {
        count++;
        if (count === n) return day;
      }
    }
    return null;
  }

  /** 指定年の固定・移動祝日一覧を生成（振替休日・国民の休日は別途付与） */
  function baseHolidays(year) {
    const list = [];
    const add = (m, d, name) => list.push({ y: year, m, d, name });

    add(1, 1, '元日');
    add(1, nthMonday(year, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    if (year >= 2020) add(2, 23, '天皇誕生日');
    add(3, vernalEquinoxDay(year), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');

    if (year === 2020) {
      add(7, 23, '海の日'); add(7, 24, 'スポーツの日'); add(8, 10, '山の日');
    } else if (year === 2021) {
      add(7, 22, '海の日'); add(7, 23, 'スポーツの日'); add(8, 8, '山の日');
    } else {
      add(7, nthMonday(year, 7, 3), '海の日');
      add(10, nthMonday(year, 10, 2), year >= 2020 ? 'スポーツの日' : '体育の日');
      if (year >= 2016) add(8, 11, '山の日');
    }

    add(9, nthMonday(year, 9, 3), '敬老の日');
    add(9, autumnalEquinoxDay(year), '秋分の日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    if (year < 2020) add(12, 23, '天皇誕生日');

    return list.filter(h => h.d != null);
  }

  function buildHolidayMap(year) {
    const map = new Map();
    [year - 1, year, year + 1].forEach(y => {
      baseHolidays(y).forEach(h => map.set(toKey(h.y, h.m, h.d), h.name));
    });

    // 振替休日：祝日が日曜の場合、直後の平日（未登録の日）を振替休日にする
    const additions = [];
    map.forEach((name, key) => {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      if (date.getDay() === 0) {
        const next = new Date(date);
        do { next.setDate(next.getDate() + 1); }
        while (map.has(toKey(next.getFullYear(), next.getMonth() + 1, next.getDate())));
        additions.push([toKey(next.getFullYear(), next.getMonth() + 1, next.getDate()), '振替休日']);
      }
    });
    additions.forEach(([key, name]) => map.set(key, name));

    // 国民の休日：前後を祝日に挟まれた平日
    const sortedKeys = Array.from(map.keys()).sort();
    const holidaySet = new Set(sortedKeys);
    sortedKeys.forEach(key => {
      const [y, m, d] = key.split('-').map(Number);
      const midKey = toKey(y, m, d + 1);
      const nextDate = new Date(y, m - 1, d + 2);
      const nextKey = toKey(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
      if (holidaySet.has(nextKey) && !holidaySet.has(midKey)) {
        const midDate = new Date(y, m - 1, d + 1);
        if (midDate.getDay() !== 0) map.set(midKey, '国民の休日');
      }
    });

    return map;
  }

  const cache = new Map();
  function getMapForYear(year) {
    if (!cache.has(year)) cache.set(year, buildHolidayMap(year));
    return cache.get(year);
  }
  function fmtKey(date) {
    return toKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  function getHolidayName(date) {
    return getMapForYear(date.getFullYear()).get(fmtKey(date)) || null;
  }
  function isHoliday(date) {
    return getHolidayName(date) !== null;
  }

  /** 土日祝のみを見た汎用の「営業日」判定（デフォルト設定） */
  function isBusinessDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    if (isHoliday(date)) return false;
    return true;
  }

  /**
   * 会社の定休日設定を反映した営業日チェッカーを生成する。
   * @param {object} config
   *   closedOnSaturday: 土曜日を休日として扱うか（デフォルトtrue）
   *   closedOnHolidays: 祝日を休日として扱うか（デフォルトtrue）。falseなら祝日でも出勤日扱い
   *   extraOffDates: 'YYYY-MM-DD'文字列の配列。個別の休業予定日
   */
  function createBusinessDayChecker(config) {
    const cfg = Object.assign({ closedOnSaturday: true, closedOnHolidays: true, extraOffDates: [] }, config || {});
    const extraSet = new Set(cfg.extraOffDates || []);

    return function checkerIsBusinessDay(date) {
      const day = date.getDay();
      if (day === 0) return false; // 日曜は常に休日
      if (day === 6 && cfg.closedOnSaturday) return false;
      if (cfg.closedOnHolidays && isHoliday(date)) return false;
      if (extraSet.has(fmtKey(date))) return false;
      return true;
    };
  }

  /** 起点から指定営業日数だけ「未来」に進めた日付を返す */
  function addBusinessDays(startDate, count, checker) {
    const isBiz = checker || isBusinessDay;
    const d = new Date(startDate);
    let remaining = count;
    while (remaining > 0) {
      d.setDate(d.getDate() + 1);
      if (isBiz(d)) remaining--;
    }
    return d;
  }

  /** 起点から指定営業日数だけ「過去」に遡った日付を返す */
  function subtractBusinessDays(startDate, count, checker) {
    const isBiz = checker || isBusinessDay;
    const d = new Date(startDate);
    let remaining = count;
    while (remaining > 0) {
      d.setDate(d.getDate() - 1);
      if (isBiz(d)) remaining--;
    }
    return d;
  }

  /** 2つの日付間（開始日を含む、終了日は含まない）の営業日数をカウント */
  function countBusinessDaysBetween(startDate, endDateExclusive, checker) {
    const isBiz = checker || isBusinessDay;
    let count = 0;
    const d = new Date(startDate);
    while (d < endDateExclusive) {
      if (isBiz(d)) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  global.HolidaysJP = {
    getHolidayName,
    isHoliday,
    isBusinessDay,
    createBusinessDayChecker,
    addBusinessDays,
    subtractBusinessDays,
    countBusinessDaysBetween,
  };
})(window);
