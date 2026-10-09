import { describe, expect, it } from 'vitest';
import { toView, viewRect, wantSideways } from './viewport';

describe('sideways play on an upright touch screen', () => {
  const upright = { touch: true, inMenu: false, editing: false, width: 390, height: 844 };

  it('turns a touch match on an upright screen, nothing else', () => {
    expect(wantSideways(upright)).toBe(true);
    expect(wantSideways({ ...upright, width: 844, height: 390 })).toBe(false); // already landscape
    expect(wantSideways({ ...upright, touch: false })).toBe(false);            // keyboard and mouse
    expect(wantSideways({ ...upright, inMenu: true })).toBe(false);            // the lobby stays upright
    expect(wantSideways({ ...upright, inMenu: true, editing: true })).toBe(true); // the touch layout editor is a match view
  });

  it('maps screen points into the turned page (quarter turn clockwise)', () => {
    // The page's top-left corner sits at the screen's top-right corner.
    expect(toView(390, 0, true, 390)).toEqual({ x: 0, y: 0 });
    // The page's bottom-left corner (x 0, y 390) is the screen's top-left corner.
    expect(toView(0, 0, true, 390)).toEqual({ x: 0, y: 390 });
    // The page's far end (x 844) is the bottom of the screen.
    expect(toView(390, 844, true, 390)).toEqual({ x: 844, y: 0 });
    expect(toView(12, 34, false, 390)).toEqual({ x: 12, y: 34 });
  });

  it('a finger drag along the screen turns into the matching drag in the page', () => {
    const a = toView(200, 300, true, 390), b = toView(200, 340, true, 390); // the finger moves down the screen
    expect(b.x - a.x).toBe(40);  // = rightwards in the turned page
    expect(b.y - a.y).toBe(0);
  });

  it('turns element rectangles too', () => {
    // A screen rectangle in the top-right corner, 100 wide and 50 tall.
    const r = viewRect({ left: 290, top: 0, right: 390, bottom: 50, width: 100, height: 50 }, true, 390);
    expect(r).toEqual({ left: 0, top: 0, right: 50, bottom: 100, width: 50, height: 100 });
  });
});
