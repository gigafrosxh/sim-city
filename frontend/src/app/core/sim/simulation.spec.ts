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
    sim.build({ tool: 'power_coal', tiles: [{ x: 4, y: 4 }] });
    expect(sim.city.tiles[5 * 32 + 5].building?.type).toBe('power_coal');
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

  it('handles loans with interest and repayment', () => {
    const sim = flatCity();
    const start = sim.city.budget.money;
    sim.takeLoan(10000);
    expect(sim.city.budget.money).toBe(start + 10000);
    expect(sim.city.budget.loanBalance).toBe(11000);
    expect(() => sim.takeLoan(10000)).toThrow();
    sim.repayLoan();
    expect(sim.city.budget.loanBalance).toBe(0);
    expect(sim.city.budget.money).toBe(start - 1000);
  });

  it('pays out goal rewards once', () => {
    const sim = flatCity();
    sim.build({ tool: 'road', tiles: line(10, 2, 13) });
    const before = sim.city.budget.money;
    sim.step();
    const goal = sim.city.goals.find((g) => g.id === 'roads')!;
    expect(goal.completed).toBeTrue();
    expect(sim.city.budget.money).toBeGreaterThanOrEqual(before + goal.reward);
  });

  it('locks buildings until the population is reached', () => {
    const sim = flatCity();
    const res = sim.build({ tool: 'stadium', tiles: [{ x: 4, y: 4 }] });
    expect(res.ok).toBeFalse();
    expect(res.error).toContain('Einwohnern');
  });

  it('places 1x1 buildings on a dragged area', () => {
    const sim = flatCity();
    const res = sim.build({ tool: 'park', tiles: line(3, 2, 6) });
    expect(res.placed).toBe(5);
    expect(res.cost).toBe(5 * 150);
  });
});
