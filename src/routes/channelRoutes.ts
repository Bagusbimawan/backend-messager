import { Router } from 'express'
import { authMiddleware } from '../middleware/authMiddleware'
import * as ch from '../controllers/channelController'

const router = Router()
router.use(authMiddleware)

router.get('/',                                ch.getMyChannels)
router.post('/',                               ch.createChannel)
router.get('/explore',                         ch.exploreChannels)
router.get('/:id',                             ch.getChannel)
router.post('/:id/subscribe',                  ch.subscribeChannel)
router.delete('/:id/subscribe',                ch.unsubscribeChannel)
router.get('/:id/posts',                       ch.getChannelPosts)
router.post('/:id/posts',                      ch.createChannelPost)
router.post('/:id/posts/:postId/react',        ch.reactToPost)
router.get('/:id/posts/:postId/comments',      ch.getPostComments)
router.post('/:id/posts/:postId/comments',     ch.addPostComment)

export default router
