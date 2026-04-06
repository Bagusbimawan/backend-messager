import { Router } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import * as g from '../controllers/groupController'

const router = Router()
router.use(authMiddleware)

router.get('/',                              g.getMyGroups)
router.post('/',                             g.createGroup)
router.get('/:groupId',                      g.getGroup)
router.get('/:groupId/messages',             g.getGroupMessages)
router.post('/:groupId/messages',            g.sendGroupMessage)
router.get('/:groupId/members',              g.getGroupMembers)
router.post('/:groupId/members',             g.addGroupMember)
router.delete('/:groupId/members/:targetUserId', g.removeGroupMember)
router.delete('/:groupId/leave',             g.leaveGroup)
router.post('/join/:inviteLink',             g.joinGroupByLink)

export default router
