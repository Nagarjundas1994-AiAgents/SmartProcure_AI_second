import cds from '@sap/cds'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

process.env.CDS_REQUIRES_LLM_KIND ??= 'llm-mock'
const { POST } = cds.test(import.meta.dirname + '/../..', '--with-mocks')

// A tiny MCP client: JSON-RPC over HTTP (streamable HTTP transport answers with one SSE "message" event)
const MCP = '/mcp/smartprocure-mcp'
const rpc = async (user, method, params, id = 1) => {
  const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
  const r = await POST(MCP, { jsonrpc: '2.0', id, method, params }, { auth: user && { username: user, password: user }, headers, responseType: 'text' })
  return JSON.parse(String(r.data).split('\n').find(l => l.startsWith('data: ')).slice(6))
}
const tools = async user => (await rpc(user, 'tools/list')).result.tools
const allowed = async user => (await tools(user)).map(t => t.name).filter(n => n !== 'describe').sort()
const call = async (user, action, parameters) => {
  const r = await rpc(user, 'tools/call', { name: action, arguments: parameters ?? {} })
  if (r.error) return { isError: true, text: r.error.message }           // unknown / not-allowed tool: JSON-RPC error
  return { isError: !!r.result.isError, text: r.result.content[0].text }
}

describe('US-13 MCP server: discovery', () => {
  it('initialize announces the tools capability', async () => {
    const r = await rpc('bob', 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    assert.ok(r.result.capabilities.tools)
    assert.equal(r.result.serverInfo.name, 'SmartProcureMcpService')
  })
  it('exposes one read-only tool per business function (no entity query tool, no write tool)', async () => {
    const list = await tools('bob')
    assert.ok(list.some(t => t.name === 'compareSupplierQuotations'))
    assert.ok(!list.some(t => ['query', 'call'].includes(t.name)))
    assert.ok(list.every(t => t.annotations.readOnlyHint === true))
  })
  it('lists only the actions the caller\'s roles allow', async () => {
    assert.deepEqual(await allowed('alice'), ['getPurchaseRequestStatus'])               // Employee
    assert.deepEqual(await allowed('dave'), ['getPurchaseOrderStatus'])                  // WarehouseEmployee
    assert.equal((await allowed('bob')).length, 10)                                     // Manager
    assert.equal((await allowed('carol')).length, 9)                                   // ProcurementOfficer (no getPendingApprovals)
    assert.deepEqual(await allowed('nobody'), [])
  })
  it('each tool carries its doc comment as description and a typed input schema', async () => {
    const t = (await tools('bob')).find(x => x.name === 'compareSupplierQuotations')
    assert.match(t.description, /Ranks all valid supplier quotations/)
    assert.equal(t.inputSchema.properties.materialNo.type, 'string')
  })
  it('rejects anonymous callers (401)', async () => {
    await assert.rejects(rpc(null, 'tools/list'), /401/)
  })
})

describe('US-13 MCP server: invocation and authorization', () => {
  it('a manager calls a tool and gets the same data as OData', async () => {
    const r = await call('bob', 'getPurchaseRequestStatus', { requestNo: 'PR-2026-0001' })
    assert.equal(r.isError, false)
    assert.match(r.text, /PR-2026-0001/); assert.match(r.text, /SUBMITTED/)
  })
  it('listing a tool is not authorization: an employee cannot call a manager tool', async () => {
    const r = await call('alice', 'getPendingApprovals')
    assert.equal(r.isError, true)                                                        // not in her enum, rejected before any handler
    assert.match(r.text, /not found/i)
  })
  it('row-level rules still apply: alice cannot read erin\'s request through MCP either', async () => {
    const r = await call('alice', 'getPurchaseRequestStatus', { requestNo: 'PR-2026-0003' })
    assert.equal(r.isError, true); assert.match(r.text, /not found/)
  })
  it('tool input is data, never code: an injection-style argument is just "not found"', async () => {
    const r = await call('bob', 'getPurchaseRequestStatus', { requestNo: "PR-1' OR 1=1 --" })
    assert.equal(r.isError, true); assert.match(r.text, /not found/)
  })
  it('analytical and recommendation tools work for a manager', async () => {
    assert.match((await call('bob', 'compareSupplierQuotations', { materialNo: 'RM-1001' })).text, /S-1001/)
    assert.match((await call('bob', 'recommendSupplier', { requestNo: 'PR-2026-0001' })).text, /ranks first/)
    assert.match((await call('bob', 'identifyDelayedPurchaseOrders')).text, /4500000002/)
    assert.match((await call('bob', 'getExpiringCertifications', { days: 3650 })).text, /ISO 9001/)
    assert.match((await call('bob', 'getProcurementSummary')).text, /requestsSubmitted/)
  })
  it('every tool call is audited with channel MCP and the real user', async () => {
    await call('frank', 'getPendingApprovals')
    const rows = await cds.run(SELECT.from('smartprocure.AuditLogs').where({ channel: 'MCP', action: 'getPendingApprovals' }))
    assert.ok(rows.some(r => r.actor === 'frank'))
  })
})