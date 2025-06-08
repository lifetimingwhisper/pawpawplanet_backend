const express = require('express')
const cors = require('cors')

const usersRouter = require('./routes/users')
const freelancersRouter = require('./routes/freelancers')
const serviceRouter = require('./routes/service')
const uploadRouter = require('./routes/upload')
const orderRouter = require('./routes/order')
const ownerRouter = require('./routes/owner')
const petRouter = require('./routes/pet')
const recommendationsRouter = require('./routes/recommendations')
const scheduleRouter = require('./routes/scheduler')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.get('/', (req, res) => {
  res.send('hello world')
})
app.use('/api/users', usersRouter)
app.use('/api/freelancers', freelancersRouter)
app.use('/api/upload', uploadRouter)

app.use('/api/services', serviceRouter)

app.use('/api/orders', orderRouter)
app.use('/api/owners', ownerRouter)
app.use('/api/recommendations', recommendationsRouter)

app.use('/api/pets', petRouter)
app.use('/api/scheduler', scheduleRouter)

// 404： 處理未匹配的路由
app.use((req, res) => {
  res.status(404).json({
    error: '找不到頁面'
  })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.log('error: ', err)
  // req.log.error(err)
  res.status(500).json({
    status: 'error',
    message: '伺服器錯誤'
  })
})

module.exports = app
