// ---------- US-01: create a purchase request ----------
import cds from '@sap/cds'


const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
export default class ProcurementService extends cds.ApplicationService {
    async init() {
        const db = cds.entities('smartprocure')
        const { PurchaseRequests, GoodsReceipts } = this.entities


        this.before('CREATE', PurchaseRequests, async req => {

            const r = req.data
            const me = await SELECT.one.from(db.Employees).where({ userId: req.user.id })
            if (!me) return req.reject(400, `No employee record for user ${req.user.id}`)
            if (!r.items?.length) return req.reject(400, 'A purchase request needs at least one item')

            let total = 0
            for (const [i, it] of r.items.entries()) {
                const m = it.material_ID && await SELECT.one.from(db.Materials, it.material_ID)
                if (it.material_ID && !m) return req.reject(400, `Item ${i + 1}: unknown material`)
                if (!(Number(it.quantity) > 0)) return req.reject(400, `Item ${i + 1}: quantity must be greater than 0`)
                if (!m && !it.description) return req.reject(400, `Item ${i + 1}: enter a material or a description`)
                it.itemNo = (i + 1) * 10
                it.description ??= m.description
                it.unit ??= m?.baseUnit ?? 'EA'
                it.estimatedPrice ??= m?.standardPrice ?? 0
                it.netAmount = round2(it.quantity * it.estimatedPrice)
                total += it.netAmount
            }

            // duplicate detection: the same person submitting the same title twice
            const open = await SELECT.from(db.PurchaseRequests).columns('requestNo', 'title').where({ requester_ID: me.ID, status: 'SUBMITTED' })
            const dup = open.find(o => o.title.trim().toLowerCase() === (r.title ?? '').trim().toLowerCase())
            if (dup) return req.reject(409, `Duplicate request: ${dup.requestNo} already has the title "${dup.title}"`)

            const all = await SELECT.from(db.PurchaseRequests).columns('requestNo')
            r.requestNo = nextNumber(`PR-${new Date().getFullYear()}-`, 4, all.map(x => x.requestNo))
            Object.assign(r, {
                requester_ID: me.ID, department_ID: me.department_ID, approver_ID: me.manager_ID,
                status: 'SUBMITTED', currency_code: 'INR', totalAmount: round2(total)
            })
        });
        // ---------- US-03: approve / reject ----------
        const decideRequest = async (req, ID, decision, comment) => {
            if (decision === 'REJECTED' && !comment) return req.reject(400, 'A comment is mandatory when rejecting a request')
            const pr = await SELECT.one.from(db.PurchaseRequests, ID)
            if (!pr) return req.reject(404, 'Purchase request not found')
            if (pr.status !== 'SUBMITTED') return req.reject(409, `Request is ${pr.status}; only SUBMITTED requests can be decided`)
            const [approver, requester] = await Promise.all([SELECT.one.from(db.Employees, pr.approver_ID), SELECT.one.from(db.Employees, pr.requester_ID)])
            if (approver?.userId !== req.user.id) return req.reject(403, 'Only the assigned approver may decide this request')
            if (requester?.userId === req.user.id) return req.reject(403, 'You cannot decide your own request')
            if (decision === 'APPROVED' && Number(pr.totalAmount) > Number(approver.approvalLimit))
                return req.reject(400, `Amount ${pr.totalAmount} exceeds your approval limit ${approver.approvalLimit}`)

            await UPDATE(db.PurchaseRequests, ID).with({ status: decision })
            await INSERT.into(db.PurchaseApprovals).entries({ request_ID: ID, approver_ID: approver.ID, decision, comment, decidedAt: new Date().toISOString() })
            await audit(req, decision, 'PurchaseRequest', pr.requestNo, comment ?? '')
            return SELECT.one.from(db.PurchaseRequests, ID)
        }
        const decide = decision => req => decideRequest(req, req.params[0].ID, decision, req.data.comment?.trim())
        this.on('approveRequest', PurchaseRequests, decide('APPROVED'))
        this.on('rejectRequest', PurchaseRequests, decide('REJECTED'))

        // ---------- human-in-the-loop: the AI agent only PROPOSES; this runs with the human's identity and the same rules ----------
        const loadProposal = async (req, id) => {
            const p = await SELECT.one.from(db.AIRecommendations, id)
            if (!p || p.kind !== 'ACTION_PROPOSAL') return req.reject(404, 'Proposal not found')
            if (p.status !== 'PENDING') return req.reject(409, `Proposal is already ${p.status}`)
            return p
        }
        this.on('confirmProposal', async req => {
            const p = await loadProposal(req, req.data.proposalId)
            const { decision, comment } = JSON.parse(p.payload)
            const pr = await decideRequest(req, p.request_ID, decision, comment?.trim())
            await UPDATE(db.AIRecommendations, p.ID).with({ status: 'CONFIRMED' })
            await audit(req, 'CONFIRM_PROPOSAL', 'AIRecommendation', p.ID, `${decision} ${p.subject}`)
            return pr
        })
        this.on('dismissProposal', async req => {
            const p = await loadProposal(req, req.data.proposalId)
            await UPDATE(db.AIRecommendations, p.ID).with({ status: 'DISMISSED' })
            await audit(req, 'DISMISS_PROPOSAL', 'AIRecommendation', p.ID)
            return 'dismissed'
        })


        this.after('CREATE', PurchaseRequests, (_, req) => audit(req, 'CREATE', 'PurchaseRequest', req.data.requestNo, `total ${req.data.totalAmount}`))
        return super.init()
    }
}