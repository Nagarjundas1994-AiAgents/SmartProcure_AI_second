import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scoreOffers, median, WEIGHTS } from '../../srv/lib/scoring.js'
import { parseCsv } from '../../srv/integrations/csv-import.js'

// Pure unit tests: no CAP server, no database, runs in milliseconds.
const offer = (o = {}) => ({ supplier: 'A', unitPrice: 100, deliveryDays: 10, quality: 90, riskLevel: 'LOW', certificationOk: true, ...o })

describe('scoring', () => {
  it('weights add up to 1', () => assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b), 1))
  it('median of odd and even lists', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5) })
  it('a single perfect offer scores 100', () => {
    const [o] = scoreOffers([offer({ quality: 100 })])
    assert.equal(o.score, 100); assert.equal(o.rank, 1)
  })
  it('cheaper and faster wins when quality and risk are equal', () => {
    const r = scoreOffers([offer({ supplier: 'slow', unitPrice: 120, deliveryDays: 20 }), offer({ supplier: 'fast' })])
    assert.deepEqual(r.map(o => o.supplier), ['fast', 'slow'])
  })
  it('a missing certification halves the risk score', () => {
    const [ok] = scoreOffers([offer()]), [bad] = scoreOffers([offer({ certificationOk: false })])
    assert.equal(Math.round((ok.score - bad.score) * 100) / 100, 5)
  })
  it('flags a price more than 30% away from the median (needs 3+ offers)', () => {
    const r = scoreOffers([offer({ supplier: 'a' }), offer({ supplier: 'b', unitPrice: 105 }), offer({ supplier: 'c', unitPrice: 200 })])
    assert.deepEqual(r.filter(o => o.unusualPrice).map(o => o.supplier), ['c'])
    assert.ok(!scoreOffers([offer(), offer({ unitPrice: 300 })]).some(o => o.unusualPrice))
  })
  it('returns [] for no offers', () => assert.deepEqual(scoreOffers([]), []))
})

describe('csv parser', () => {
  it('handles quotes, commas, doubled quotes and CRLF', () => {
    assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']])
  })
  it('ignores blank lines', () => assert.deepEqual(parseCsv('a\n\n\nb\n'), [['a'], ['b']]))
})