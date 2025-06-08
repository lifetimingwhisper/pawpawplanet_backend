require('dotenv').config();
const express = require('express')
const router = express.Router()
const scheduler = require('../controllers/scheduler')

// 驗證 Secret
function authenticateSchedulerSecret(req, res, next) {
  const secret = req.headers.authorization?.split(' ')[1]
  if (secret === process.env.UPDATE_SECRET) {
    return next();
  }
  return res.status(403).json({ message: 'Unauthorized' })
}

router.get('/ping', authenticateSchedulerSecret, scheduler.ping)
router.post('/close-due-orders', authenticateSchedulerSecret, scheduler.closeDueOrders)

module.exports = router