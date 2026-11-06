// Pure functions: no database, no CAP. Developer 2 unit-tests them in test/supplier/scoring.test.js.
export const WEIGHTS = { price: 0.40, delivery: 0.25, quality: 0.25, risk: 0.10 }
const RISK = { LOW: 100, MEDIUM: 60, HIGH: 20 }

export const median = xs => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** offers: [{ unitPrice, deliveryDays, quality (0-100), riskLevel, certificationOk }] -> offers with score, rank, unusualPrice */
export function scoreOffers(offers, weights = WEIGHTS) {
  if (!offers.length) return []
  const minPrice = Math.min(...offers.map(o => o.unitPrice))
  const minDays = Math.min(...offers.map(o => o.deliveryDays || 1))
  const med = median(offers.map(o => o.unitPrice))
  const scored = offers.map(o => {
    const price = 100 * minPrice / o.unitPrice
    const delivery = 100 * minDays / (o.deliveryDays || 1)
    const risk = (RISK[o.riskLevel] ?? 60) * (o.certificationOk ? 1 : 0.5)
    const score = weights.price * price + weights.delivery * delivery + weights.quality * (o.quality ?? 0) + weights.risk * risk
    return { ...o, score: Math.round(score * 100) / 100, unusualPrice: offers.length >= 3 && Math.abs(o.unitPrice - med) / med > 0.30 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map((o, i) => ({ ...o, rank: i + 1 }))
}

export const explain = (best, offers) =>
  `${best.supplier} ranks first with score ${best.score}` +
  (offers.length > 1 ? ` (next: ${offers[1].supplier} ${offers[1].score})` : '') +
  `; unit price ${best.unitPrice}, delivery ${best.deliveryDays} days, quality ${best.quality}, risk ${best.riskLevel}` +
  (best.certificationOk ? '' : ', WARNING: no valid certification')