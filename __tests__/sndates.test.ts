/**
 * Dates, pinned under a timezone that is not UTC.
 *
 * This file exists because the machine Task Hub is built on runs in UTC, where
 * midnight local and midnight UTC are the same instant — so a date bug that
 * shifted every task by a day was invisible to every other test and only
 * appeared on the device, where a to-do created for tomorrow showed as today.
 *
 * `process.env.TZ` is set before `src/sncloud` is imported, and the import is
 * therefore deliberately deferred: Node reads the zone when it first needs it,
 * and a top-level import would bind it too early.
 */

process.env.TZ = 'America/New_York';

const {snDate, snEpoch} = require('../src/sncloud');

describe('a date west of Greenwich', () => {
  it('is not in UTC, or this file is proving nothing', () => {
    expect(new Date(2026, 8, 16).getTimezoneOffset()).toBeGreaterThan(0);
  });

  it('writes the day the user chose, not the day before', () => {
    // The bug: midnight UTC on the 16th is 20:00 on the 15th in New York, and
    // the To-Do app renders the instant in the device's own zone.
    const written = snEpoch('2026-09-16');
    const shown = new Date(written);
    expect(shown.getFullYear()).toBe(2026);
    expect(shown.getMonth()).toBe(8);
    expect(shown.getDate()).toBe(16);
    expect(shown.getHours()).toBe(0);
  });

  it('round-trips its own writing', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2026-09-16', '2026-12-31']) {
      expect(snDate(snEpoch(date))).toBe(date);
    }
  });

  it('round-trips across a daylight-saving boundary', () => {
    // New York moves on 8 March 2026. A fixed offset would slip an hour here
    // and, at midnight, that is a whole day.
    for (const date of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01']) {
      expect(snDate(snEpoch(date))).toBe(date);
    }
  });

  it('reads a date the tablet wrote as UTC midnight as that same date', () => {
    // Whichever reading lands on an exact midnight is the one that was meant,
    // so a to-do from a writer that thought in UTC is not shifted either.
    expect(snDate(Date.parse('2026-09-16T00:00:00Z'))).toBe('2026-09-16');
  });

  it('still treats zero as no date', () => {
    expect(snDate(0)).toBe('');
    expect(snEpoch('')).toBe(0);
  });
});
