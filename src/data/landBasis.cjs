const DEFAULT_MARKET_LAND_PER_DOOR = 100000;
const DEFAULT_ED1_LAND_PER_DOOR = 30000;

function perDoorLandBasis({ type, units, isEd1 = false } = {}) {
  const doorCount = Number(units || 0);
  if (!['Multifamily', 'Mixed-Use'].includes(type) || !Number.isFinite(doorCount) || doorCount <= 0) return null;
  const perDoor = isEd1 ? DEFAULT_ED1_LAND_PER_DOOR : DEFAULT_MARKET_LAND_PER_DOOR;
  return {
    value: Math.round(perDoor * doorCount),
    source: isEd1 ? 'default_ed1_per_door' : 'default_market_per_door',
    metricLabel: 'price per door',
    metricValue: perDoor,
    basisQuantity: doorCount,
    compCount: 0,
    matchLabel: isEd1 ? 'ED1 default' : 'market-rate default',
    comps: [],
  };
}

module.exports = {
  DEFAULT_MARKET_LAND_PER_DOOR,
  DEFAULT_ED1_LAND_PER_DOOR,
  perDoorLandBasis,
};
