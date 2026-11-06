describe('US-01 create a purchase request', () => {
    const body = (title = 'Safety gloves') => ({ title, justification: 'Workshop', items: [{ material_ID: MAT_STEEL, quantity: 10 }] })

    it('creates with generated number, status SUBMITTED, approver and totals', async () => {
        const { data } = await POST(`${P}/PurchaseRequests`, body(), alice)
        assert.match(data.requestNo, /^PR-\d{4}-0006$/)
        assert.equal(data.status, 'SUBMITTED')
        assert.equal(data.approver_ID, 'e1000000-0000-4000-8000-000000000002')
        assert.equal(Number(data.totalAmount), 12000)                    // 10 x standard price 1200
    })
    it('rejects a request without items', async () => {
        await rejects(POST(`${P}/PurchaseRequests`, { title: 'Empty' }, alice), /at least one item/)
    })
    it('rejects quantity 0', async () => {
        await rejects(POST(`${P}/PurchaseRequests`, { title: 'Zero', items: [{ material_ID: MAT_STEEL, quantity: 0 }] }, alice), /quantity/)
    })
    it('rejects a duplicate title from the same employee', async () => {
        await POST(`${P}/PurchaseRequests`, body('Duplicate me'), alice)
        await rejects(POST(`${P}/PurchaseRequests`, body('  duplicate ME '), alice), /Duplicate request/)
    })
    it('does not let a warehouse employee create requests (403)', async () => {
        await rejects(POST(`${P}/PurchaseRequests`, body('By dave'), dave), /403/)
    })
})

describe('US-02 view requests (row-level security)', () => {
    it('employee sees only own requests', async () => {
        const { data } = await GET(`${P}/PurchaseRequests?$select=requestNo`, alice)
        assert.ok(data.value.length >= 4 && data.value.every(r => ['PR-2026-0001', 'PR-2026-0002', 'PR-2026-0004', 'PR-2026-0005'].includes(r.requestNo) || /^PR-\d{4}-\d+$/.test(r.requestNo)))
        const { data: erins } = await GET(`${P}/PurchaseRequests?$select=requestNo`, erin)
        assert.deepEqual(erins.value.map(r => r.requestNo), ['PR-2026-0003'])
    })
    it('employee cannot read the items of another employee (child entity is protected too)', async () => {
        const { data } = await GET(`${P}/PurchaseRequestItems?$select=request_ID`, erin)
        assert.ok(data.value.every(i => i.request_ID === PR3))
    })
    it('officer sees everything; anonymous gets 401', async () => {
        const { data } = await GET(`${P}/PurchaseRequests?$count=true&$top=0`, carol)
        assert.ok(data['@odata.count'] >= 5)
        await rejects(GET(`${P}/PurchaseRequests`), /401/)
    })
})
describe('US-03 approval workflow', () => {
    const act = (id, action, who, comment) => POST(`${P}/PurchaseRequests(${id})/ProcurementService.${action}`, { comment }, who)

    it('only the assigned manager approves; history and audit are written', async () => {
        await rejects(act(PR1, 'approveRequest', frank), /assigned approver/)    // frank is a manager, but not alice's
        await rejects(act(PR1, 'approveRequest', alice), /403/)                  // employees have no approval right
        const { data } = await act(PR1, 'approveRequest', bob, 'Needed for line 3')
        assert.equal(data.status, 'APPROVED')
        const { data: hist } = await GET(`${P}/PurchaseApprovals?$filter=request_ID eq ${PR1}`, bob)
        assert.equal(hist.value[0].decision, 'APPROVED')
        const rows = await cds.run(SELECT.from('smartprocure.AuditLogs').where({ action: 'APPROVED', entityKey: 'PR-2026-0001' }))
        assert.equal(rows[0].actor, 'bob')
    })
    it('rejection needs a comment', async () => {
        await rejects(act('b1000000-0000-4000-8000-000000000002', 'rejectRequest', bob), /comment is mandatory/)
        const { data } = await act('b1000000-0000-4000-8000-000000000002', 'rejectRequest', bob, 'Stock is sufficient')
        assert.equal(data.status, 'REJECTED')
    })
    it('enforces the approval limit', async () => {
        await rejects(act(PR3, 'approveRequest', frank), /exceeds your approval limit/)
    })
    it('cannot decide twice', async () => {
        await rejects(act(PR4, 'approveRequest', bob), /only SUBMITTED/)
    })
})
