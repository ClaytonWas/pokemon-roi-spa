import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySealed, compileTierRules, mapTier, cardNumber, variantKey, parsePackCount, cardKind, isCard } from '../src/classify.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/sealed-names.json', import.meta.url), 'utf8'));
const rules = compileTierRules(JSON.parse(readFileSync(new URL('../data/rarity-map.json', import.meta.url), 'utf8')));

test('every real tcgcsv sealed name classifies (nothing left unclassified)', () => {
  const unclassified = fixture.names.filter((n) => classifySealed(n) === null);
  assert.deepEqual(unclassified, []);
  assert.ok(fixture.names.length > 1000);
});

test('ranked sealed types and variants (real names)', () => {
  const cases = [
    ['Surging Sparks Booster Pack', 'pack', null],
    ['Surging Sparks Sleeved Booster Pack', 'pack', 'sleeved'],
    ['Sword and Shield Base Set Sleeved Booster Pack', 'pack', 'sleeved'],
    ['Surging Sparks Booster Box', 'box', null],
    ['Journey Together Enhanced Booster Box', 'box', 'enhanced'],
    ['Surging Sparks Elite Trainer Box', 'etb', null],
    ['Mega Evolution Elite Trainer Box [Mega Lucario]', 'etb', null],
    ['Prismatic Evolutions Elite Trainer Box (Dollar General Exclusive)', 'etb', 'retailer-exclusive'],
    ['Surging Sparks Pokemon Center Elite Trainer Box (Exclusive)', 'pc-etb', null],
    ['Perfect Order Pokemon Center Elite Trainer Box', 'pc-etb', null],
    ['Crown Zenith Pokemon Center Elite Trainer Box Plus', 'pc-etb', 'plus'],
    ['Mega Evolution Pokemon Center Elite Trainer Box (Exclusive) [Mega Gardevoir]', 'pc-etb', null],
    ['Surging Sparks Booster Bundle (LGS)', 'bundle', 'lgs'],
    ['Surging Sparks Booster Bundle (Retail)', 'bundle', 'retail'],
    ['151 Booster Bundle', 'bundle', null],
  ];
  for (const [name, type, variant] of cases) {
    const c = classifySealed(name);
    assert.equal(c?.type, type, name);
    assert.equal(c?.variant, variant, name);
  }
});

test('look-alikes that must NOT be ranked (real names)', () => {
  const cases = [
    ['Surging Sparks Booster Box Case', 'case'],
    ['Surging Sparks Pokemon Center Elite Trainer Box (Exclusive) Case', 'case'],
    ['Surging Sparks Booster Bundle Case (LGS)', 'case'],
    ['Mega Evolution Enhanced Booster Case', 'case'],
    ['Sword & Shield Elite Trainer Box [Set of 2]', 'other'],
    ['Surging Sparks Booster Pack Art Bundle [Set of 4]', 'other'],
    ['Surging Sparks Half Booster Box', 'other'],
    ['151 Booster Bundle Display', 'other'],
    ['Prismatic Evolutions Booster Bundle + Surprise Box Bundle (Sam\'s Club)', 'other'],
    ['Surging Sparks Build & Battle Box', 'other'],
    ['Surging Sparks 3 Pack Blisters [Zapdos]', 'other'],
    ['Code Card - Surging Sparks Booster Pack', 'other'],
    ['Code Card - Surging Spark Elite Trainer Box', 'other'],
    ['30th Celebration Classic Collection Pack', 'other'],
    ['Darkness Energy (2022 Unnumbered)', 'other'],
    ['Celebrations Collector Chest', 'other'],
  ];
  for (const [name, type] of cases) assert.equal(classifySealed(name)?.type, type, name);
});

test('isCard requires Number and Rarity (code cards have Rarity only)', () => {
  assert.equal(isCard({ extendedData: [{ name: 'Number', value: '001/191' }, { name: 'Rarity', value: 'Common' }] }), true);
  assert.equal(isCard({ extendedData: [{ name: 'Rarity', value: 'Code Card' }, { name: 'CardText', value: '' }] }), false);
});

test('rarity -> tier mapping (real cards)', () => {
  const t = (name, rarity, groupId, era, cardType = 'Psychic', subset = null) => mapTier({ name, rarity, groupId, cardType, subset }, era, rules);
  // SV/ME: TCGplayer rarity strings pass straight through
  assert.equal(t('Pikachu ex - 238/191', 'Special Illustration Rare', 23651, 'sv'), 'Special Illustration Rare');
  assert.equal(t('Mega Lucario ex', 'Mega Hyper Rare', 24380, 'me'), 'Mega Hyper Rare');
  assert.equal(t('Brilliant Blender', 'ACE SPEC Rare', 23651, 'sv', 'Item'), 'ACE SPEC Rare');
  assert.equal(t('Pikachu - 036/128', 'Pikachu Rare', 24722, 'me', 'Lightning'), 'Pikachu Rare');
  assert.equal(t('Oddish', 'Shiny Rare', 23353, 'sv', 'Grass'), 'Shiny Rare');
  // Pattern parallels: hit tiers in PRE / BLK / WHT, reverse-holo pool in Ascended Heroes
  assert.equal(t('Klink (Master Ball Pattern)', 'Common', 24325, 'sv', 'Metal'), 'Master Ball Pattern');
  assert.equal(t('Exeggcute (Poke Ball Pattern)', 'Common', 23821, 'sv', 'Grass'), 'Poké Ball Pattern');
  assert.equal(t("Erika's Oddish (Energy Symbol Pattern)", 'Common', 24541, 'me', 'Grass'), 'Reverse Holo');
  assert.equal(t('Chikorita (Friend Ball)', 'Common', 24541, 'me', 'Grass'), 'Reverse Holo');
  assert.equal(t("Team Rocket's Tarountula (Team Rocket)", 'Common', 24541, 'me', 'Grass'), 'Reverse Holo');
  // SWSH: TCGplayer lumps these under "Ultra Rare" / "Secret Rare"
  assert.equal(t('Umbreon V (Alternate Full Art)', 'Ultra Rare', 2848, 'swsh', 'Darkness'), 'Alt Art V');
  assert.equal(t('Umbreon VMAX (Alternate Art Secret)', 'Secret Rare', 2848, 'swsh', 'Darkness'), 'Alt Art VMAX');
  assert.equal(t('Espeon V (Full Art)', 'Ultra Rare', 2848, 'swsh'), 'Full Art V');
  assert.equal(t('Aroma Lady (Full Art)', 'Ultra Rare', 2848, 'swsh', 'Supporter'), 'Full Art Trainer');
  assert.equal(t('Espeon VMAX', 'Ultra Rare', 2848, 'swsh'), 'VMAX/VSTAR');
  assert.equal(t('Lugia VSTAR', 'Ultra Rare', 3170, 'swsh', 'Colorless'), 'VMAX/VSTAR');
  assert.equal(t('Golurk V', 'Ultra Rare', 2848, 'swsh', 'Psychic'), 'V');
  assert.equal(t('Leafeon VMAX (Secret)', 'Secret Rare', 2848, 'swsh', 'Grass'), 'Secret Rare');
  assert.equal(t('Radiant Alakazam', 'Radiant Rare', 3170, 'swsh'), 'Radiant Rare');
  // Crown Zenith specials
  assert.equal(t('Metal Energy (Texture Full Art)', 'Ultra Rare', 17688, 'swsh', 'Basic Energy'), 'Texture Energy');
  assert.equal(t('Leon', 'Holo Rare', 17688, 'swsh', 'Supporter'), 'Signature Trainer');
  assert.equal(t('Leon', 'Holo Rare', 3170, 'swsh', 'Supporter'), 'Holo Rare'); // only Crown Zenith signs its Supporters
  assert.equal(t('Sky Seal Stone', 'Holo Rare', 17688, 'swsh', 'Tool'), 'Holo Rare'); // a Holo Rare Tool is not a signature Supporter
  // Subset groups
  assert.equal(t('Charizard', 'Ultra Rare', 3172, 'swsh', 'Fire', 'Trainer Gallery'), 'TG Non-V');
  assert.equal(t('Pikachu VMAX', 'Ultra Rare', 3172, 'swsh', 'Lightning', 'Trainer Gallery'), 'TG V/Trainer');
  assert.equal(t("Boss's Orders", 'Ultra Rare', 3172, 'swsh', 'Supporter', 'Trainer Gallery'), 'TG V/Trainer');
  assert.equal(t('Mew VMAX (Secret)', 'Secret Rare', 3172, 'swsh', 'Psychic', 'Trainer Gallery'), 'TG Gold');
  assert.equal(t('Lapras', 'Ultra Rare', 17689, 'swsh', 'Water', 'Galarian Gallery'), 'GG Non-V');
  assert.equal(t('Origin Forme Palkia VSTAR (Secret)', 'Secret Rare', 17689, 'swsh', 'Water', 'Galarian Gallery'), 'GG Gold');
  assert.equal(t('Charizard', 'Classic Collection', 24837, 'me', 'Fire', 'Classic Collection'), 'Classic Collection');
  // Unknown rarity -> unmapped
  assert.equal(t('Something', 'Mystery Rare', 1, 'sv'), null);
});

test('cardKind from Card Type', () => {
  assert.equal(cardKind('Supporter'), 'trainer');
  assert.equal(cardKind('Trainer - Pokemon Tool'), 'trainer');
  assert.equal(cardKind('Basic Energy'), 'energy');
  assert.equal(cardKind('Special Rainbow Energy'), 'energy');
  assert.equal(cardKind('Darkness'), 'pokemon');
  assert.equal(cardKind(null), null);
});

test('card numbers and price-variant keys', () => {
  assert.equal(cardNumber('166/203'), 166);
  assert.equal(cardNumber('TG05/TG30'), 5);
  assert.equal(cardNumber('GG70/GG70'), 70);
  assert.equal(cardNumber('004/102'), 4);
  assert.equal(cardNumber(''), null);
  assert.equal(variantKey('Reverse Holofoil'), 'reverseHolofoil');
  assert.equal(variantKey('Normal'), 'normal');
  assert.equal(variantKey('1st Edition Holofoil'), '1stEditionHolofoil');
});

test('pack counts parsed from real CardText', () => {
  assert.equal(parsePackCount('Product details:<br>• 9 Pokémon TCG: Mega Evolution booster packs<br>'), 9);
  assert.equal(parsePackCount('Expand your collection with this Booster Bundle containing six booster packs.'), 6);
  assert.equal(parsePackCount('the 151 expansion!  Expand your collection with this Booster Bundle containing six booster packs'), 6);
  assert.equal(parsePackCount('65 card sleeves and a metallic coin—plus 10 booster packs'), 10);
  assert.equal(parsePackCount('• 8 Pokémon TCG: Sword & Shield—Evolving Skies booster packs'), 8);
  assert.equal(parsePackCount('30 reasons to honor Pikachu, as each booster pack contains one'), null);
  assert.equal(parsePackCount(null), null);
});
