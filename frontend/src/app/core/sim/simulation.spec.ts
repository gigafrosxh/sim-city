import { CitySimulation } from './simulation';

function flatCity(): CitySimulation {
  const sim = CitySimulation.create('test', { name: 'Test', width: 32, height: 32, seed: 42 });
  // Make the map predictable: all grass.
  for (const t of sim.city.tiles) t.terrain = 'grass';
  return sim;
}

const line = (y: number, x0: number, x1: number) =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y }));

describe('CitySimulation', () => {
  it('builds roads and charges money', () => {
    const sim = flatCity();
    const before = sim.city.budget.money;
    const res = sim.build({ tool: 'road', tiles: line(10, 5, 14) });
    expect(res.ok).toBeTrue();
    expect(res.placed).toBe(10);
    expect(res.cost).toBe(100);
    expect(sim.city.budget.money).toBe(before - 100);
    expect(res.changedTiles.length).toBe(10);
  });

  it('rejects multi-tile buildings on occupied ground', () => {
    const sim = flatCity();
    sim.build({ tool: 'road', tiles: [{ x: 6, y: 6 }] });
    const res = sim.build({ tool: 'power_coal', tiles: [{ x: 5, y: 5 }] });
    expect(res.ok).toBeFalse();
    expect(res.error).toBeTruthy();
  });

  it('powers connected zones and grows them over time', () => {
    const sim = flatCity();
    sim.build({ tool: 'road', tiles: line(10, 2, 20) });
    sim.build({ tool: 'power_coal', tiles: [{ x: 2, y: 11 }] });
    const zones = [...line(9, 5, 18), ...line(11, 5, 18)];
    sim.build({ tool: 'zone_residential', tiles: zones.filter((c) => c.y === 9) });
    sim.build({ tool: 'zone_industrial', tiles: zones.filter((c) => c.y === 11) });
    for (let i = 0; i < 400; i++) sim.step();
    const s = sim.city.stats;
    expect(s.powerSupply).toBe(600);
    expect(s.population).toBeGreaterThan(0);
    expect(s.industrialJobs).toBeGreaterThan(0);
    expect(sim.city.history.length).toBeGreaterThan(10);
  });

  it('bulldozes a whole multi-tile building', () => {
    const sim = flatCity();
    sim.build({ tool: 'school', tiles: [{ x: 4, y: 4 }] });
    expect(sim.city.tiles[5 * 32 + 5].building?.type).toBe('school');
    const res = sim.build({ tool: 'bulldoze', tiles: [{ x: 5, y: 5 }] });
    expect(res.ok).toBeTrue();
    expect(res.changedTiles.length).toBe(4);
    expect(sim.city.tiles[4 * 32 + 4].building).toBeNull();
  });

  it('lowers demand when taxes rise', () => {
    const sim = flatCity();
    sim.setTaxes({ residential: 0, commercial: 0, industrial: 0 });
    const low = { ...sim.city.demand };
    sim.setTaxes({ residential: 20, commercial: 20, industrial: 20 });
    expect(sim.city.demand.residential).toBeLessThan(low.residential);
    expect(sim.city.demand.industrial).toBeLessThan(low.industrial);
  });
});
