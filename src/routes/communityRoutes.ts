import { Router } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import * as c from '../controllers/communityController'

const router = Router()
router.use(authMiddleware)

router.get('/',                                    c.getMyCommunities)
router.post('/',                                   c.createCommunity)
router.get('/explore',                             c.exploreCommunities)
router.get('/:id',                                 c.getCommunityDetail)
router.post('/join/:inviteLink',                   c.joinCommunity)
router.delete('/:id/leave',                        c.leaveCommunity)
router.post('/:id/topics',                         c.createTopic)
router.get('/:id/topics/:topicId/messages',        c.getTopicMessages)
router.post('/:id/topics/:topicId/messages',       c.sendTopicMessage)
router.get('/:id/members',                         c.getCommunityMembers)
router.put('/:id/members/:userId/role',            c.updateMemberRole)
router.delete('/:id/members/:userId',              c.kickMember)

export default router
