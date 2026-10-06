import { describe, expect, it } from 'vitest';
import { countByCountry, countryOf } from './tzcountry';

describe('time zone → country', () => {
  it('maps common zones', () => {
    expect(countryOf('Asia/Taipei')).toBe('Taiwan');
    expect(countryOf('Asia/Tokyo')).toBe('Japan');
    expect(countryOf('Asia/Hong_Kong')).toBe('Hong Kong');
    expect(countryOf('America/Los_Angeles')).toBe('United States');
    expect(countryOf('Europe/London')).toBe('United Kingdom');
    expect(countryOf('Australia/Sydney')).toBe('Australia');
  });

  it('knows legacy aliases', () => {
    expect(countryOf('ROC')).toBe('Taiwan');
    expect(countryOf('Asia/Calcutta')).toBe('India');
    expect(countryOf('Asia/Saigon')).toBe('Vietnam');
    expect(countryOf('Europe/Kiev')).toBe('Ukraine');
  });

  it('calls unknown, empty and generic zones Other', () => {
    expect(countryOf('')).toBe('Other');
    expect(countryOf('UTC')).toBe('Other');
    expect(countryOf('Etc/GMT+8')).toBe('Other');
    expect(countryOf('Mars/Olympus_Mons')).toBe('Other');
  });

  it('counts players per country, most first, Other last among equals', () => {
    expect(countByCountry(['Asia/Taipei', 'Asia/Taipei', 'UTC', 'Asia/Tokyo', 'ROC'])).toEqual([['Taiwan', 3], ['Japan', 1], ['Other', 1]]);
  });
});
