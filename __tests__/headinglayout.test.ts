/**
 * Where the date sits on a newly created daily note.
 *
 * The geometry is the part worth pinning: it is expressed as fractions of the
 * page so a Nomad and a Manta get proportionally the same heading, and a box
 * placed wrong is a heading written off the edge of somebody's note.
 */

import {headingLayout} from '../src/headinglayout';

/** The two panels this plugin is calibrated against. */
const MANTA = {width: 1920, height: 2560};
const NOMAD = {width: 1404, height: 1872};

describe('headingLayout', () => {
  it('puts the box near the top, inside a margin', () => {
    const {rect} = headingLayout(MANTA);
    expect(rect.left).toBeGreaterThan(0);
    expect(rect.top).toBeGreaterThan(0);
    // Well within the top tenth of the page: this is a heading, not a body line.
    expect(rect.top).toBeLessThan(MANTA.height * 0.1);
  });

  it('leaves an equal margin at both edges', () => {
    const {rect} = headingLayout(MANTA);
    expect(rect.left).toBe(MANTA.width - rect.right);
  });

  it('never runs off the page', () => {
    for (const page of [MANTA, NOMAD]) {
      const {rect} = headingLayout(page);
      expect(rect.right).toBeLessThanOrEqual(page.width);
      expect(rect.bottom).toBeLessThanOrEqual(page.height);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('is a well-formed rectangle', () => {
    for (const page of [MANTA, NOMAD]) {
      const {rect} = headingLayout(page);
      expect(rect.right).toBeGreaterThan(rect.left);
      expect(rect.bottom).toBeGreaterThan(rect.top);
    }
  });

  it('scales with the panel rather than being fixed', () => {
    // A fixed size would be proportionally larger on the smaller panel, which
    // is the mistake the page-mark caption's font bounds exist to avoid.
    const manta = headingLayout(MANTA);
    const nomad = headingLayout(NOMAD);
    expect(manta.fontSize).toBeGreaterThan(nomad.fontSize);
    expect(manta.rect.left).toBeGreaterThan(nomad.rect.left);
  });

  it('keeps the same proportions on both panels', () => {
    const manta = headingLayout(MANTA);
    const nomad = headingLayout(NOMAD);
    const share = (l: {rect: {left: number}}, p: {width: number}) => l.rect.left / p.width;
    expect(share(manta, MANTA)).toBeCloseTo(share(nomad, NOMAD), 2);
  });

  it('gives the box room for a line of that size', () => {
    for (const page of [MANTA, NOMAD]) {
      const {rect, fontSize} = headingLayout(page);
      expect(rect.bottom - rect.top).toBeGreaterThan(fontSize);
    }
  });

  it('stays legible on an implausibly small page', () => {
    // Nothing should be able to produce a heading of two pixels, whatever the
    // device reports.
    const {rect, fontSize} = headingLayout({width: 200, height: 260});
    expect(fontSize).toBeGreaterThanOrEqual(20);
    expect(rect.right).toBeGreaterThan(rect.left);
  });

  it('places the box so the GLYPHS land near the top, not the box', () => {
    // insertText draws the baseline 2.05 x font size below the rect's top, so
    // taking the rect at face value puts a "heading" a fifth of the way down
    // the page. Measured on hardware by taoist22's sn-datetime plugin.
    for (const page of [MANTA, NOMAD]) {
      const {rect, fontSize} = headingLayout(page);
      const baseline = rect.top + fontSize * 2.05;
      expect(baseline / page.height).toBeCloseTo(0.07, 2);
    }
  });

  it('starts the box above where the text will appear', () => {
    const {rect, fontSize} = headingLayout(MANTA);
    expect(rect.top).toBeLessThan(MANTA.height * 0.07);
    expect(rect.top + fontSize * 2.05).toBeGreaterThan(rect.top);
  });

  it('never asks for a negative top, however small the page', () => {
    // The offset is subtracted, so a small enough page would otherwise push the
    // box above the paper and leave the device to decide what that meant.
    for (const page of [{width: 200, height: 260}, {width: 60, height: 80}]) {
      expect(headingLayout(page).rect.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('is wide enough for a long date format', () => {
    // The box is full width inside the margins on purpose: the device reports
    // no text metrics, so a box measured from a character count would wrap the
    // moment somebody picked a longer format.
    const {rect, fontSize} = headingLayout(MANTA);
    const longest = 'Wednesday 14 September 2026'.length;
    expect(rect.right - rect.left).toBeGreaterThan(longest * fontSize * 0.5);
  });
});
