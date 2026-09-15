import {endForStart} from '../src/format';

describe('endForStart', () => {
  it('gives a new event an hour', () => {
    expect(endForStart('', '', '09:00')).toBe('10:00');
  });

  it('keeps the duration the event already had', () => {
    // A ninety-minute meeting dragged across the day stays ninety minutes.
    expect(endForStart('09:00', '10:30', '14:00')).toBe('15:30');
  });

  it('moves an hour-long event by exactly the hour', () => {
    expect(endForStart('09:00', '10:00', '14:00')).toBe('15:00');
  });

  it('falls back to an hour when there is no duration to hold on to', () => {
    expect(endForStart('09:00', '', '14:00')).toBe('15:00');
    // A zero-length pair is not a duration worth preserving.
    expect(endForStart('09:00', '09:00', '14:00')).toBe('15:00');
  });

  it('keeps a duration that crosses midnight, because that is what it is', () => {
    // minutesBetween reads an end earlier than its start as the next day, so
    // 14:00-10:00 is a twenty-hour event rather than a mistake. Moving it to
    // 08:00 keeps those twenty hours and lands at 04:00. Whether the form
    // should let such an event be built at all is a separate question; this
    // rule does not get to second-guess it.
    expect(endForStart('14:00', '10:00', '08:00')).toBe('04:00');
  });

  it('drops the end when the event becomes all-day', () => {
    expect(endForStart('09:00', '10:30', '')).toBe('');
  });

  it('wraps past midnight rather than inventing a clamped end', () => {
    // 23:30 for an hour genuinely does finish the next day; 00:30 is the
    // honest time even though one stored date cannot say which day.
    expect(endForStart('', '', '23:30')).toBe('00:30');
  });
});
