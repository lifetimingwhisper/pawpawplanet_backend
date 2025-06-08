const { dataSource } = require('../db/data-source')
const dayjs = require('dayjs')
const orderHelper = require('../lib/order-helpers')


function ping(req, res, next) {
  console.log('scheduler: wake the server up......')
  return res.status(200).json({
    status: 'success',
    message: '排程啟動中.....'
  })
}

async function closeDueOrders(req, res, next) {
  console.log('scheduler: update due orders......')

  const queryRunner = dataSource.createQueryRunner()
  const today = dayjs()
  const dueDate = today.format('YYYY-MM-DD')
  
  try {
    await queryRunner.connect()
    await queryRunner.startTransaction()
    
    const orderRepo = queryRunner.manager.getRepository('Order')
    const orders = await orderRepo
      .find({
        where: {
          service_date: dueDate,
        }
      })

    orders.forEach(order => {
      if (order.status === orderHelper.ORDER_STATUS.PENDING) {
        // 保姆逾期未回應
        order.status = orderHelper.EXPIRED_NO_RESPONSE
        order.did_freelancer_close_the_order = true
      } else if (order.status === orderHelper.ORDER_STATUS.ACCEPTED) {
        // 飼主逾期未付款
        order.status = orderHelper.EXPIRED_NO_PAY
        order.did_owner_close_the_order = true
      } else if (order.status === orderHelper.ORDER_STATUS.PAID) {
        // 訂單完成
        order.status = orderHelper.ORDER_STATUS.COMPLETED
        order.did_freelancer_close_the_order = true
        order.did_owner_close_the_order = true
      } else {
        console.log(`order ${order.id}'s status (${order.status}) means bugs... `)
      }
    })
    
    await orderRepo.save(orders)
    await queryRunner.commitTransaction()
    return res.status(200).json({
      status: 'success', 
      message: '排程完成'
    })
  } catch (error) {
    await queryRunner.rollbackTransaction()
    console.error('closeDueOrders 發生錯誤:', error)
    return res.status(500).json({
      status: 'error',
      message: `排程修改訂單狀態時發生錯誤: ${error.message}`
    })
  } finally {
    await queryRunner.release()
  }
}  

module.exports = {
  ping,
  closeDueOrders
}