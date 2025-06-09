require('dotenv').config();
const express = require('express')
const router = express.Router()
const scheduler = require('../controllers/scheduler')

// 驗證 Secret
function authenticateSchedulerSecret(req, res, next) {
  const authHeader = req.headers.authorization; // 獲取完整的 Authorization 頭，例如 "Bearer YOUR_SECRETS_KEY_VALUE"
  
  if (!authHeader) {
    return res.status(401).json({ message: 'Authorization header missing' });
  }

  const parts = authHeader.split(' '); // 將 "Bearer YOUR_SECRETS_KEY_VALUE" 分割成 ["Bearer", "YOUR_SECRETS_KEY_VALUE"]
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ message: 'Authorization header format must be Bearer <token>' });
  }

  const token = parts[1]; // 獲取實際的 Token 值：YOUR_SECRETS_KEY_VALUE
  if (token === process.env.SCHEDULER_SECRET) {
    return next();
  }
  return res.status(403).json({ message: 'Unauthorized' })
}

router.get('/ping', authenticateSchedulerSecret, scheduler.ping)
router.post('/close-due-orders', authenticateSchedulerSecret, scheduler.closeDueOrders)

module.exports = router